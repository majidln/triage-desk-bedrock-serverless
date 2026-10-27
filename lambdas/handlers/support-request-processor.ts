import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { TicketStatus, SupportTicketMessage, TicketAnalytics, TicketFailure, Urgency } from '../shared/types';
import { logBedrockTicketProcessorError } from '../shared/errors-handler';
import { classifyError, PermanentError } from '../shared/classify-error';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const ddClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddClient);
const bedrockClient = new BedrockRuntimeClient({});
const snsClient = new SNSClient({});

// sqs event handler: each record succeeds or fails on its own, and only the failed ones
// are reported back to SQS for a retry (needs ReportBatchItemFailures on the event source)
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
    console.log(`Start Processing ${event.Records.length} tickets`);

    const batchItemFailures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
        try {
            await processRecord(record);
        } catch (err) {
            console.error(`Failed to process message ${record.messageId}`, err);
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }

    console.log(`END PROCESSING TICKETS: ${batchItemFailures.length} of ${event.Records.length} failed`);
    return { batchItemFailures };
};

// Throwing from here means "retry this record"; returning means "done, delete it".
async function processRecord(record: SQSRecord): Promise<void> {
    let message: SupportTicketMessage;
    try {
        message = parseMessage(record.body);
    } catch (err) {
        // Poisoned message: retrying can't fix it, and there's no ticket to mark FAILED,
        // so this log line is the only trace it leaves.
        console.error(
            JSON.stringify({
                level: 'ERROR',
                event: 'PoisonedMessage',
                messageId: record.messageId,
                error: err instanceof Error ? err.message : String(err),
                body: record.body.substring(0, 200),
            }),
        );
        return;
    }

    // Only the Bedrock call is classified: DynamoDB and SNS errors below are always retried
    // (DynamoDB also has a ValidationException, which isn't Bedrock's permanent one).
    let analytics: TicketAnalytics;
    try {
        analytics = await generateTicketAnalytics(message);
    } catch (err) {
        if (classifyError(err) === 'transient') {
            throw err;
        }
        await markTheTicketFailed(message, err);
        return;
    }

    console.log(`Ticket ${message.ticketId} analytics:`, analytics);

    await updateTheTicket(message, analytics);

    console.log(`Ticket analytics generated for ${message.ticketId}`);

    await notifyTheSupportTeam(message, analytics);

    console.log(`Admin notified for ticket ${message.ticketId}`);
}

function parseMessage(body: string): SupportTicketMessage {
    let message: Partial<SupportTicketMessage>;
    try {
        message = JSON.parse(body);
    } catch {
        throw new PermanentError('Message body is not JSON');
    }
    if (typeof message?.ticketId !== 'string' || typeof message.content !== 'string') {
        throw new PermanentError('Message body has no ticketId or content');
    }
    return { ticketId: message.ticketId, content: message.content };
}

async function generateTicketAnalytics(message: SupportTicketMessage): Promise<TicketAnalytics> {
    const prompt = `Analyze the following customer support ticket and provide:
1. Urgency level (${Object.values(Urgency).join(', ')})
2. A professional response

Ticket: ${message.content}

Respond in JSON format:
{
    "urgency": "The ticket urgency level",
    "response": "Your response to the ticket"
}`;

    const modelId = process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0';
    console.log(`Using model ID: ${modelId}`);

    const input = {
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
            messages: [
                {
                    role: 'user',
                    content: [{ text: prompt }],
                },
            ],
            inferenceConfig: {
                max_new_tokens: 512,
                temperature: 0.1,
                top_p: 0.9,
            },
        }),
    };

    try {
        const command = new InvokeModelCommand(input);
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        // Nova returns content in this structure
        const resultText = responseBody.output.message.content[0].text.trim();

        return parseModelAnswer(resultText);
    } catch (err) {
        await logBedrockTicketProcessorError(message.ticketId, err, {
            modelId,
            promptLength: prompt.length,
            ticketContent: message.content.substring(0, 200),
        });

        // No fallback answer: the caller decides between retrying and marking the ticket FAILED
        throw err;
    }
}

// A model answer we can't use is a permanent failure, never a default urgency or reply.
function parseModelAnswer(resultText: string): TicketAnalytics {
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    let result: { urgency?: unknown; response?: unknown };
    try {
        result = JSON.parse(jsonMatch?.[0] ?? '');
    } catch {
        throw new PermanentError('Model answer is not JSON');
    }
    if (!Object.values(Urgency).includes(result.urgency as Urgency)) {
        throw new PermanentError(`Model answer has an invalid urgency: ${String(result.urgency)}`);
    }
    if (typeof result.response !== 'string' || result.response.trim() === '') {
        throw new PermanentError('Model answer has no response');
    }
    return { urgency: result.urgency as Urgency, response: result.response };
}

async function updateTheTicket(message: SupportTicketMessage, analytics: TicketAnalytics): Promise<void> {
    try {
        const updateCommand = new UpdateCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            Key: {
                id: message.ticketId,
            },
            UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, analytics = :analytics',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':status': TicketStatus.PROCESSED,
                ':updatedAt': new Date().toISOString(),
                ':analytics': {
                    ...analytics,
                    generatedAt: new Date().toISOString(),
                },
            },
        });
        await docClient.send(updateCommand);
    } catch (err) {
        console.log(`Error processing ticket ${message.ticketId}: ${err}`);
        throw err;
    }
}

async function markTheTicketFailed(message: SupportTicketMessage, err: unknown): Promise<void> {
    const failedAt = new Date().toISOString();
    const failure: TicketFailure = {
        errorName: err instanceof Error ? err.name : 'UnknownError',
        message: err instanceof Error ? err.message : String(err),
        failedAt,
    };
    // A failure here is thrown to the handler, so the record is retried rather than lost.
    await docClient.send(
        new UpdateCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            Key: {
                id: message.ticketId,
            },
            UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, failure = :failure',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':status': TicketStatus.FAILED,
                ':updatedAt': failedAt,
                ':failure': failure,
            },
        }),
    );
    console.error(JSON.stringify({ level: 'ERROR', event: 'TicketFailed', ticketId: message.ticketId, ...failure }));
}

async function notifyTheSupportTeam(message: SupportTicketMessage, analytics: TicketAnalytics): Promise<void> {
    const input = {
        TopicArn: process.env.SNS_TOPIC_ARN,
        Message: `New support ticket received: ${message.ticketId}\n\n\n\nContent: ${message.content}\n\n\n\nAnalytics: ${analytics.response}`,
        Subject: `::${analytics.urgency}:: New Support Ticket`,
    };
    const command = new PublishCommand(input);
    await snsClient.send(command);
}
