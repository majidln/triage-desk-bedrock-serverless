import { describe, expect, it, beforeEach } from '@jest/globals';
import { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DEFAULT_PAGE_SIZE, encodePageKey, handler } from '../../handlers/list-support-tickets';

const ddbMock = mockClient(DynamoDBDocumentClient);

const lambdaContext = { functionName: 'triage-desk-ListFunction', awsRequestId: 'test-request-id' } as Context;

// The caller (the token's `sub`) in events/list-tickets.json
const USER_ID = 'auth0|test-user';

// The example event used with `sam local invoke` (an HTTP API v2 event, limit=10).
function listEvent(query?: Record<string, string>): APIGatewayProxyEventV2WithJWTAuthorizer {
  const path = join(__dirname, '../../../events/list-tickets.json');
  const event = JSON.parse(readFileSync(path, 'utf8')) as APIGatewayProxyEventV2WithJWTAuthorizer;
  return query === undefined ? event : { ...event, queryStringParameters: query };
}

function withClaims(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: Record<string, string>,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const authorizer = { ...event.requestContext.authorizer, jwt: { ...event.requestContext.authorizer.jwt, claims } };
  return { ...event, requestContext: { ...event.requestContext, authorizer } };
}

function storedTicket(id: string, fields: Record<string, unknown>) {
  return { id, userId: USER_ID, createdAt: '2026-10-27T10:00:00Z', ...fields };
}

describe('list-support-tickets', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it("queries the index for the caller's tickets only, newest first, without content", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler(listEvent(), lambdaContext);

    const query = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
    expect(query.IndexName).toBe('test-tickets-by-user');
    expect(query.ExpressionAttributeValues).toEqual({ ':userId': USER_ID });
    expect(query.ScanIndexForward).toBe(false);
    expect(query.Limit).toBe(10);
    expect(query.ProjectionExpression).not.toContain('content');
  });

  it('returns each ticket as the customer sees it, with the reply only once processed', async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        storedTicket('t-2', { status: 'PROCESSED', triage: { urgency: 'LOW', response: 'Click Invite.' } }),
        storedTicket('t-1', { status: 'RECEIVED' }),
      ],
    });

    const result = await handler(listEvent(), lambdaContext);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      tickets: [
        { ticketId: 't-2', status: 'PROCESSED', createdAt: '2026-10-27T10:00:00Z', response: 'Click Invite.' },
        { ticketId: 't-1', status: 'RECEIVED', createdAt: '2026-10-27T10:00:00Z' },
      ],
    });
  });

  it('uses the default page size when no limit is given', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });

    await handler(listEvent({}), lambdaContext);

    expect(ddbMock.commandCalls(QueryCommand)[0].args[0].input.Limit).toBe(DEFAULT_PAGE_SIZE);
  });

  it('returns a nextToken that starts the next page where this one ended', async () => {
    const lastKey = { id: 't-1', userId: USER_ID, createdAt: '2026-10-27T10:00:00Z' };
    ddbMock
      .on(QueryCommand)
      .resolves({ Items: [storedTicket('t-1', { status: 'RECEIVED' })], LastEvaluatedKey: lastKey });

    const first = await handler(listEvent(), lambdaContext);
    const { nextToken } = JSON.parse(first.body!);
    await handler(listEvent({ nextToken }), lambdaContext);

    expect(ddbMock.commandCalls(QueryCommand)[1].args[0].input.ExclusiveStartKey).toEqual(lastKey);
  });

  it('returns no nextToken on the last page', async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [storedTicket('t-1', { status: 'RECEIVED' })] });

    const result = await handler(listEvent(), lambdaContext);

    expect(JSON.parse(result.body!)).not.toHaveProperty('nextToken');
  });

  it.each([
    ['zero', '0'],
    ['over the maximum', '51'],
    ['not a whole number', '2.5'],
    ['not a number', 'ten'],
  ])('returns 400 for a limit that is %s, without querying', async (_label, limit) => {
    const result = await handler(listEvent({ limit }), lambdaContext);

    expect(result.statusCode).toBe(400);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it.each([
    ['not base64 JSON', 'not-a-token'],
    ['a JSON value that is not a key', Buffer.from('"hello"').toString('base64url')],
    [
      "another user's page",
      encodePageKey({ id: 't-1', userId: 'auth0|someone-else', createdAt: '2026-10-27T10:00:00Z' }),
    ],
  ])('returns 400 for a nextToken that is %s, without querying', async (_label, nextToken) => {
    const result = await handler(listEvent({ nextToken }), lambdaContext);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body!)).toEqual({ message: 'nextToken is not valid' });
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('returns 401 when the token has no sub, without querying', async () => {
    const result = await handler(withClaims(listEvent(), {}), lambdaContext);

    expect(result.statusCode).toBe(401);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('returns 500 when DynamoDB fails', async () => {
    ddbMock.on(QueryCommand).rejects(new Error('DynamoDB unavailable'));

    const result = await handler(listEvent(), lambdaContext);

    expect(result.statusCode).toBe(500);
  });
});
