import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Context, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { TicketStatus, SupportTicketMessage, TicketTriage, TicketFailure } from '../shared/types';
import { classifyError, PermanentError } from '../shared/classify-error';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { requireEnv } from '../shared/env';
import { invokeTriageModel } from '../shared/triage-model';
import { logger } from '../shared/logger';

// Read once at cold start: a missing variable fails here, not on the first ticket.
const config = {
    tableName: requireEnv('SUPPORT_TICKETS_TABLE'),
    topicArn: requireEnv('SNS_TOPIC_ARN'),
    modelId: requireEnv('BEDROCK_MODEL_ID'),
};

const ddClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddClient);
const snsClient = new SNSClient({});

// How one record ended when processRecord returns. A record that throws isn't an outcome:
// it goes back to SQS for a retry.
//   processed: triaged, saved and the support team notified
//   failed:    the ticket is marked FAILED (a permanent error), no retry
//   dropped:   the message isn't a ticket we can read, so there's nothing to mark
export type Outcome = 'processed' | 'failed' | 'dropped';

// sqs event handler: each record succeeds or fails on its own, and only the failed ones
// are reported back to SQS for a retry (needs ReportBatchItemFailures on the event source)
export const handler = async (event: SQSEvent, context: Context): Promise<SQSBatchResponse> => {
    // Adds the request id, function name and cold start to every log line of this invocation
    logger.addContext(context);

    const batchItemFailures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
        try {
            await processRecord(record);
        } catch (err) {
            logger.warn('RecordRetried', { messageId: record.messageId, error: err });
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }

    return { batchItemFailures };
};

// Returning an outcome means "done, delete the message"; throwing means "retry it".
export async function processRecord(record: SQSRecord): Promise<Outcome> {
    const startedAt = Date.now();
    let message: SupportTicketMessage;
    try {
        message = parseMessage(record.body);
    } catch (err) {
        // Poisoned message: retrying can't fix it, and there's no ticket to mark FAILED,
        // so this log line is the only trace it leaves.
        logger.error('PoisonedMessage', { messageId: record.messageId, bodyLength: record.body.length, error: err });
        return 'dropped';
    }

    // Only the Bedrock call is classified: DynamoDB and SNS errors below are always retried
    // (DynamoDB also has a ValidationException, which isn't Bedrock's permanent one).
    // There's no fallback answer: a transient error is retried, a permanent one marks the ticket FAILED.
    let triage: TicketTriage;
    try {
        triage = await invokeTriageModel(message.content, config.modelId);
    } catch (err) {
        if (classifyError(err) === 'transient') {
            throw err;
        }
        const failure = await markFailed(message, err);
        logger.error('TicketFailed', { ticketId: message.ticketId, messageId: record.messageId, failure });
        return 'failed';
    }

    await saveTriage(message, triage);
    await notifySupportTeam(message, triage);

    logger.info('TicketProcessed', {
        ticketId: message.ticketId,
        messageId: record.messageId,
        urgency: triage.urgency,
        durationMs: Date.now() - startedAt,
    });
    return 'processed';
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

async function saveTriage(message: SupportTicketMessage, triage: TicketTriage): Promise<void> {
    const now = new Date().toISOString();
    await docClient.send(
        new UpdateCommand({
            TableName: config.tableName,
            Key: {
                id: message.ticketId,
            },
            UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, analytics = :analytics',
            ExpressionAttributeNames: {
                '#status': 'status',
            },
            ExpressionAttributeValues: {
                ':status': TicketStatus.PROCESSED,
                ':updatedAt': now,
                ':analytics': {
                    ...triage,
                    generatedAt: now,
                },
            },
        }),
    );
}

async function markFailed(message: SupportTicketMessage, err: unknown): Promise<TicketFailure> {
    const failedAt = new Date().toISOString();
    const failure: TicketFailure = {
        errorName: err instanceof Error ? err.name : 'UnknownError',
        message: err instanceof Error ? err.message : String(err),
        failedAt,
    };
    // A failure here is thrown to the handler, so the record is retried rather than lost.
    await docClient.send(
        new UpdateCommand({
            TableName: config.tableName,
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
    return failure;
}

async function notifySupportTeam(message: SupportTicketMessage, triage: TicketTriage): Promise<void> {
    const input = {
        TopicArn: config.topicArn,
        Message: `New support ticket received: ${message.ticketId}\n\n\n\nContent: ${message.content}\n\n\n\nDraft reply: ${triage.response}`,
        Subject: `::${triage.urgency}:: New Support Ticket`,
    };
    const command = new PublishCommand(input);
    await snsClient.send(command);
}
