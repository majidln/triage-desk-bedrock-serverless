import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { callerId } from '../shared/caller';
import { requireEnv } from '../shared/env';
import { json } from '../shared/http';
import { logger } from '../shared/logger';
import { STORED_TICKET_PROJECTION, StoredTicket, toTicketView } from '../shared/ticket-view';

// Read once at cold start: a missing variable fails here, not on the first request.
const config = {
  tableName: requireEnv('SUPPORT_TICKETS_TABLE'),
};

// Ticket ids are UUIDs (the receiver makes them). Checking the format first turns a
// junk id into a clear 400, instead of a DynamoDB error (a 500) for an oversized key.
const TICKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_FOUND = { message: 'ticket not found' };

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

  const ticketId = event.queryStringParameters?.ticketId;
  if (!ticketId) {
    return json(400, { message: 'ticketId is required' });
  }
  if (!TICKET_ID.test(ticketId)) {
    logger.info('InvalidTicketId', { userId, ticketIdLength: ticketId.length });
    return json(400, { message: 'ticketId must be a UUID' });
  }

  try {
    const ticket = await readTicket(ticketId);

    // Someone else's ticket gets the same 404 as a missing one, so ids can't be probed.
    // The log keeps the difference: a caller trying other people's ids is worth seeing.
    if (!ticket) {
      logger.info('TicketNotFound', { ticketId, userId });
      return json(404, NOT_FOUND);
    }
    if (ticket.userId !== userId) {
      logger.warn('TicketAccessDenied', { ticketId, userId });
      return json(404, NOT_FOUND);
    }

    logger.info('TicketFetched', { ticketId, userId, status: ticket.status });
    return json(200, toTicketView(ticket));
  } catch (err) {
    logger.error('RequestFailed', { ticketId, userId, error: err });
    return json(500, { message: 'some error happened' });
  }
};

async function readTicket(ticketId: string): Promise<StoredTicket | undefined> {
  const { Item: item } = await docClient.send(
    new GetCommand({ TableName: config.tableName, Key: { id: ticketId }, ...STORED_TICKET_PROJECTION }),
  );
  return item as StoredTicket | undefined;
}
