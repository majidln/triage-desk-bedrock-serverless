import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { TicketStatus, CreateTicketRequest, CreateTicketResponse } from '../shared/types';
import { callerId } from '../shared/caller';
import { requireEnv } from '../shared/env';
import { checkTicket, TicketCheck } from '../shared/guardrail';
import { json } from '../shared/http';
import { logger } from '../shared/logger';

// Read once at cold start: a missing variable fails here, not on the first request.
const config = {
  tableName: requireEnv('SUPPORT_TICKETS_TABLE'),
};

// The longest ticket we accept. Real tickets are a few hundred characters (the longest in the
// evaluation set is 135); anything far longer is a mistake or an attempt to run up model costs.
export const MAX_CONTENT_LENGTH = 4_000;
// The raw body is checked before JSON.parse, so a huge body is never parsed. Room for the
// longest content even if every character were escaped, plus the JSON around it.
export const MAX_BODY_BYTES = 16_384;

const ddClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddClient);

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  context: Context,
): Promise<APIGatewayProxyStructuredResultV2> => {
  logger.addContext(context);

  const userId = callerId(event);
  if (!userId) {
    logger.error('CallerUnknown', { routeKey: event.routeKey });
    return json(401, { message: 'unauthorized' });
  }

  // A bad request is the client's mistake: 400 or 413 with the reason, never a 500
  const parsed = parseRequest(event.body);
  if ('statusCode' in parsed) {
    if (parsed.statusCode === 413) {
      logger.info('TicketTooLarge', { userId, bodyBytes: Buffer.byteLength(event.body ?? '') });
    }
    return json(parsed.statusCode, { message: parsed.message });
  }

  // Before the first write: every copy of a ticket (table, stream, queue, email) holds only the
  // masked text. Without a check there's no masked text, so refuse the ticket; the client can
  // send it again. Only the error's name is logged, in case the message quotes the ticket.
  let check: TicketCheck;
  try {
    check = await checkTicket(parsed.content);
  } catch (err) {
    logger.error('GuardrailFailed', { userId, errorName: (err as Error).name });
    return json(503, { message: 'please try again shortly' });
  }

  try {
    const ticketId = uuidv4();
    const now = new Date().toISOString();

    // The only write: the table's stream and the intake pipe put the ticket on the queue,
    // so there's no second step that could fail and leave the ticket stuck in RECEIVED.
    await docClient.send(
      new PutCommand({
        TableName: config.tableName,
        Item: {
          id: ticketId,
          content: check.content,
          guardrailFlags: check.flags,
          status: TicketStatus.RECEIVED,
          createdAt: now,
          updatedAt: now,
          userId,
        },
      }),
    );

    logger.info('TicketReceived', {
      ticketId,
      userId,
      contentLength: check.content.length,
      flags: check.flags,
      piiTypes: check.piiTypes,
    });
    const response: CreateTicketResponse = {
      message: 'new ticket has been created for this request',
      ticketId,
    };
    return json(202, response);
  } catch (err) {
    logger.error('RequestFailed', { userId, error: err });
    return json(500, { message: 'some error happened' });
  }
};

interface Rejection {
  statusCode: 400 | 413;
  message: string;
}

// The request body as a ticket request, or why it isn't one. Only `content` is read: who sent
// the ticket comes from the token, never from the body.
function parseRequest(body: string | undefined): CreateTicketRequest | Rejection {
  if (body !== undefined && Buffer.byteLength(body) > MAX_BODY_BYTES) {
    return { statusCode: 413, message: `body must be at most ${MAX_BODY_BYTES} bytes` };
  }
  let request: unknown;
  try {
    request = JSON.parse(body ?? '');
  } catch {
    return { statusCode: 400, message: 'body must be JSON' };
  }
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    return { statusCode: 400, message: 'body must be a JSON object' };
  }
  const { content } = request as Record<string, unknown>;
  if (typeof content !== 'string' || content.trim() === '') {
    return { statusCode: 400, message: 'content is required' };
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return { statusCode: 413, message: `content must be at most ${MAX_CONTENT_LENGTH} characters` };
  }
  return { content };
}
