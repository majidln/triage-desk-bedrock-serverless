import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { SQSEvent } from 'aws-lambda';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { TicketStatus, SupportTicketMessage, TicketAnalytics, Urgency } from '../shared/types';
import { logBedrockTicketProcessorError } from '../shared/errors-handler';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';

const ddClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddClient);
const bedrockClient = new BedrockRuntimeClient({});
const snsClient = new SNSClient({});

// sqs event handler
export const handler = async (event: SQSEvent): Promise<void> => {
    try {
        console.log(`Start Processing ${event.Records.length} tickets`);

        for (const record of event.Records) {
            const message: SupportTicketMessage = JSON.parse(record.body);

            const analytics: TicketAnalytics = await generateTicketAnalytics(message);

            console.log(`Ticket ${message.ticketId} analytics:`, analytics);

            await updateTheTicket(message, analytics);

            console.log(`Ticket analytics generated for ${message.ticketId}`);

            await notifyTheSupportTeam(message, analytics);

            console.log(`Admin notified for ticket ${message.ticketId}`);
        }

        console.log('END PROCESSING TICKETS');
    } catch (err) {
        console.log(err);
        throw err;
    }
};

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

        const jsonMatch = resultText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]);
            return {
                urgency: (result.urgency as Urgency) || Urgency.MEDIUM,
                response: result.response || 'Thank you for contacting support.',
            };
        }
        throw new Error('Could not parse JSON from response');
    } catch (err) {
        await logBedrockTicketProcessorError(message.ticketId, err, {
            modelId,
            promptLength: prompt.length,
            ticketContent: message.content.substring(0, 200),
        });

        // Return fallback response
        return {
            urgency: Urgency.MEDIUM,
            response: 'Thank you for contacting support. We have received your request and will get back to you soon.',
        };
    }
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

async function notifyTheSupportTeam(message: SupportTicketMessage, analytics: TicketAnalytics): Promise<void> {
    const input = {
        TopicArn: process.env.SNS_TOPIC_ARN,
        Message: `New support ticket received: ${message.ticketId}\n\n\n\nContent: ${message.content}\n\n\n\nAnalytics: ${analytics.response}`,
        Subject: `::${analytics.urgency}:: New Support Ticket`,
    };
    const command = new PublishCommand(input);
    await snsClient.send(command);
}
