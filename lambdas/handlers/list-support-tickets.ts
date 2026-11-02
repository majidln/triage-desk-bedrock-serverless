import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { callerId } from '../shared/caller';
import { requireEnv } from '../shared/env';
import { json } from '../shared/http';
import { logger } from '../shared/logger';
import { STORED_TICKET_PROJECTION, StoredTicket, toTicketView } from '../shared/ticket-view';
import { ListTicketsResponse } from '../shared/types';

// Read once at cold start: a missing variable fails here, not on the first request.
const config = {
  tableName: requireEnv('SUPPORT_TICKETS_TABLE'),
  indexName: requireEnv('TICKETS_BY_USER_INDEX'),
};

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

const ddClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddClient);

// Where a page ends in the index: DynamoDB's LastEvaluatedKey, handed to the client as an
// opaque nextToken and checked when it comes back.
interface PageKey {
  id: string;
  userId: string;
  createdAt: string;
}

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

  const limit = parseLimit(event.queryStringParameters?.limit);
  if (limit === undefined) {
    return json(400, { message: `limit must be a whole number from 1 to ${MAX_PAGE_SIZE}` });
  }

  const token = event.queryStringParameters?.nextToken;
  const startKey = token === undefined ? undefined : decodePageKey(token, userId);
  if (startKey === null) {
    logger.info('InvalidNextToken', { userId, tokenLength: token?.length });
    return json(400, { message: 'nextToken is not valid' });
  }

  try {
    // Newest first. The index holds only the caller's tickets under their userId, and it
    // projects no content, so a page never reads what a customer wrote.
    const { Items: items = [], LastEvaluatedKey: lastKey } = await docClient.send(
      new QueryCommand({
        TableName: config.tableName,
        IndexName: config.indexName,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ScanIndexForward: false,
        Limit: limit,
        ExclusiveStartKey: startKey,
        ...STORED_TICKET_PROJECTION,
      }),
    );

    const response: ListTicketsResponse = { tickets: (items as StoredTicket[]).map(toTicketView) };
    if (lastKey) {
      response.nextToken = encodePageKey(lastKey as PageKey);
    }
    logger.info('TicketsListed', { userId, count: items.length, hasMore: lastKey !== undefined });
    return json(200, response);
  } catch (err) {
    logger.error('RequestFailed', { userId, error: err });
    return json(500, { message: 'some error happened' });
  }
};

// The page size, or undefined when the query parameter isn't one.
function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  const limit = Number(raw);
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_PAGE_SIZE ? limit : undefined;
}

export function encodePageKey(key: PageKey): string {
  return Buffer.from(JSON.stringify({ id: key.id, userId: key.userId, createdAt: key.createdAt })).toString(
    'base64url',
  );
}

// The token as a start key, or null when it isn't one of ours or belongs to another user.
// Without the check, a hand-made token would reach DynamoDB and fail there as a 500.
function decodePageKey(token: string, userId: string): PageKey | null {
  let key: unknown;
  try {
    key = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof key !== 'object' || key === null) {
    return null;
  }
  const { id, userId: keyUserId, createdAt } = key as Record<string, unknown>;
  if (typeof id !== 'string' || typeof createdAt !== 'string' || keyUserId !== userId) {
    return null;
  }
  return { id, userId, createdAt };
}
