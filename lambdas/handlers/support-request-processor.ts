import { AttributeValue, ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, UpdateCommandInput } from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { Context, SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import {
  TicketStatus,
  SupportTicket,
  SupportTicketMessage,
  TicketTriage,
  TicketFailure,
  LlmUsage,
  TriageResult,
} from '../shared/types';
import { classifyError, PermanentError } from '../shared/classify-error';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { requireEnv } from '../shared/env';
import { invokeTriageModel, MODEL_ATTEMPT_TIMEOUT_MS, MODEL_MAX_ATTEMPTS } from '../shared/triage-model';
import { logger } from '../shared/logger';
import { priceFor } from '../shared/model-prices';

// Read once at cold start: a missing variable fails here, not on the first ticket.
const config = {
  tableName: requireEnv('SUPPORT_TICKETS_TABLE'),
  topicArn: requireEnv('SNS_TOPIC_ARN'),
  modelId: requireEnv('BEDROCK_MODEL_ID'),
};

// Any model can be deployed; one without a price still triages tickets, they just have no
// cost. Said once per cold start rather than on every ticket.
if (priceFor(config.modelId) === undefined) {
  logger.warn('ModelPriceMissing', { modelId: config.modelId });
}

// The longest one ticket can take: every model attempt timing out, plus a few seconds for
// the SDK's backoff, DynamoDB and SNS. A ticket is only started with at least this much left.
const TICKET_BUDGET_MS = MODEL_ATTEMPT_TIMEOUT_MS * MODEL_MAX_ATTEMPTS + 5_000;

const ddClient = new DynamoDBClient({});
// A token count Bedrock didn't report is undefined; it's left out of the item rather than
// failing the save (and retrying a ticket that was triaged).
const docClient = DynamoDBDocumentClient.from(ddClient, { marshallOptions: { removeUndefinedValues: true } });
const snsClient = new SNSClient({});

// How one record ended when processRecord returns. A record that throws isn't an outcome:
// it goes back to SQS for a retry.
//   processed: triaged, saved and the support team notified
//   failed:    the ticket is marked FAILED (a permanent error), no retry
//   duplicate: an earlier delivery of the same ticket already handled it
//   dropped:   the message isn't a ticket we can act on, so there's nothing to mark
export type Outcome = 'processed' | 'failed' | 'duplicate' | 'dropped';

// sqs event handler: each record succeeds or fails on its own, and only the failed ones
// are reported back to SQS for a retry (needs ReportBatchItemFailures on the event source)
export const handler = async (event: SQSEvent, context: Context): Promise<SQSBatchResponse> => {
  // Adds the request id, function name and cold start to every log line of this invocation
  logger.addContext(context);

  const batchItemFailures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    // If Lambda stops us at its timeout, nothing is returned and SQS retries the whole
    // batch. So rather than start a ticket we may not finish, hand it back and return.
    const remainingMs = context.getRemainingTimeInMillis();
    if (remainingMs < TICKET_BUDGET_MS) {
      logger.warn('RecordDeferred', { messageId: record.messageId, remainingMs });
      batchItemFailures.push({ itemIdentifier: record.messageId });
      continue;
    }
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
// SQS can deliver the same message more than once, so every step here is safe to repeat.
export async function processRecord(record: SQSRecord): Promise<Outcome> {
  const startedAt = Date.now();
  const { messageId } = record;
  let message: SupportTicketMessage;
  try {
    message = parseMessage(record.body);
  } catch (err) {
    // Poisoned message: retrying can't fix it, and there's no ticket to mark FAILED,
    // so this log line is the only trace it leaves.
    logger.error('PoisonedMessage', { messageId, bodyLength: record.body.length, error: err });
    return 'dropped';
  }
  const { ticketId } = message;

  // Only the Bedrock call is classified: DynamoDB and SNS errors below are always retried
  // (DynamoDB also has a ValidationException, which isn't Bedrock's permanent one).
  // There's no fallback answer: a transient error is retried, a permanent one marks the ticket FAILED.
  let result: TriageResult;
  try {
    result = await invokeTriageModel(message.content, config.modelId);
  } catch (err) {
    if (classifyError(err) === 'transient') {
      throw err;
    }
    const failure = toFailure(err);
    const result = await markFailed(ticketId, failure);
    if (!result.updated) {
      return alreadyHandled(message, result.current, messageId);
    }
    logger.error('TicketFailed', { ticketId, messageId, failure });
    return 'failed';
  }

  const { triage, usage } = result;
  const saved = await saveTriage(ticketId, triage, usage);
  if (!saved.updated) {
    return alreadyHandled(message, saved.current, messageId);
  }
  await notifyAndRecord(message, triage);

  logger.info('TicketProcessed', {
    ticketId,
    messageId,
    urgency: triage.urgency,
    modelId: usage.modelId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
    durationMs: Date.now() - startedAt,
  });
  return 'processed';
}

// An earlier delivery moved this ticket on before us (or there's no such ticket).
async function alreadyHandled(
  message: SupportTicketMessage,
  current: StoredTicket | null,
  messageId: string,
): Promise<Outcome> {
  const { ticketId } = message;
  if (current === null) {
    logger.error('TicketNotFound', { ticketId, messageId });
    return 'dropped';
  }
  // The earlier delivery saved the triage but never sent the email (SNS failed, then the
  // retry lost the race to its own save). Send it now, with the triage that was saved.
  if (current.status === TicketStatus.PROCESSED && current.analytics && !current.notifiedAt) {
    await notifyAndRecord(message, current.analytics);
    logger.info('TicketProcessed', { ticketId, messageId, urgency: current.analytics.urgency, notifyOnly: true });
    return 'processed';
  }
  logger.info('DuplicateMessage', { ticketId, messageId, status: current.status });
  return 'duplicate';
}

// Each message is one DynamoDB stream record, as the intake pipe sends it from the table:
//   { "eventName": "INSERT", "dynamodb": { "NewImage": { "id": { "S": "…" }, "content": { "S": "…" }, … } }, … }
function parseMessage(body: string): SupportTicketMessage {
  let record: { dynamodb?: { NewImage?: Record<string, AttributeValue> } } | null;
  try {
    record = JSON.parse(body);
  } catch {
    throw new PermanentError('Message body is not JSON');
  }
  const image = record?.dynamodb?.NewImage;
  if (!image) {
    throw new PermanentError('Message is not a DynamoDB stream record');
  }
  let ticket: Record<string, unknown>;
  try {
    ticket = unmarshall(image);
  } catch {
    throw new PermanentError('Stream record has an unreadable ticket');
  }
  if (typeof ticket.id !== 'string' || typeof ticket.content !== 'string') {
    throw new PermanentError('Stream record has no ticket id or content');
  }
  return { ticketId: ticket.id, content: ticket.content };
}

// The parts of a stored ticket the duplicate check reads.
type StoredTicket = Pick<SupportTicket, 'status' | 'notifiedAt'> & { analytics?: TicketTriage };

// Whether a guarded update was made. When it wasn't, `current` is the ticket as it is now,
// or null when there's no such ticket.
type GuardedUpdate = { updated: true } | { updated: false; current: StoredTicket | null };

// Runs an update only while the ticket is still RECEIVED, so of two deliveries of the same
// ticket only the first one moves it on (RECEIVED → PROCESSED or FAILED).
async function updateIfReceived(input: UpdateCommandInput): Promise<GuardedUpdate> {
  try {
    await docClient.send(
      new UpdateCommand({
        ...input,
        ConditionExpression: '#status = :received',
        ExpressionAttributeValues: { ...input.ExpressionAttributeValues, ':received': TicketStatus.RECEIVED },
        // On a failed condition, DynamoDB returns the current item: no extra read needed
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      }),
    );
    return { updated: true };
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return { updated: false, current: err.Item ? (unmarshall(err.Item) as StoredTicket) : null };
    }
    throw err;
  }
}

async function saveTriage(ticketId: string, triage: TicketTriage, usage: LlmUsage): Promise<GuardedUpdate> {
  const now = new Date().toISOString();
  return updateIfReceived({
    TableName: config.tableName,
    Key: {
      id: ticketId,
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, analytics = :analytics, #usage = :usage',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#usage': 'usage',
    },
    ExpressionAttributeValues: {
      ':status': TicketStatus.PROCESSED,
      ':updatedAt': now,
      ':analytics': {
        ...triage,
        generatedAt: now,
      },
      ':usage': usage,
    },
  });
}

function toFailure(err: unknown): TicketFailure {
  return {
    errorName: err instanceof Error ? err.name : 'UnknownError',
    message: err instanceof Error ? err.message : String(err),
    failedAt: new Date().toISOString(),
  };
}

// A DynamoDB error here is thrown to the handler, so the record is retried rather than lost.
async function markFailed(ticketId: string, failure: TicketFailure): Promise<GuardedUpdate> {
  return updateIfReceived({
    TableName: config.tableName,
    Key: {
      id: ticketId,
    },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt, failure = :failure',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': TicketStatus.FAILED,
      ':updatedAt': failure.failedAt,
      ':failure': failure,
    },
  });
}

// Sends the email, then records that it was sent. If the second write fails, the retry
// sends the email again: a rare duplicate email is better than a missed one.
async function notifyAndRecord(message: SupportTicketMessage, triage: TicketTriage): Promise<void> {
  await snsClient.send(
    new PublishCommand({
      TopicArn: config.topicArn,
      Message: `New support ticket received: ${message.ticketId}\n\n\n\nContent: ${message.content}\n\n\n\nDraft reply: ${triage.response}`,
      Subject: `::${triage.urgency}:: New Support Ticket`,
    }),
  );
  await docClient.send(
    new UpdateCommand({
      TableName: config.tableName,
      Key: {
        id: message.ticketId,
      },
      UpdateExpression: 'SET notifiedAt = :notifiedAt',
      ExpressionAttributeValues: {
        ':notifiedAt': new Date().toISOString(),
      },
    }),
  );
}
