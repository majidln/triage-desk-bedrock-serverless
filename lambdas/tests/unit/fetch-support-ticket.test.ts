import { describe, expect, it, beforeEach } from '@jest/globals';
import { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { readFileSync } from 'fs';
import { join } from 'path';
import { handler } from '../../handlers/fetch-support-ticket';

const ddbMock = mockClient(DynamoDBDocumentClient);

const lambdaContext = { functionName: 'triage-desk-FetchFunction', awsRequestId: 'test-request-id' } as Context;

// The ticket id and caller (the token's `sub`) in events/fetch-ticket.json
const TICKET_ID = '11111111-2222-3333-4444-555555555555';
const USER_ID = 'auth0|test-user';

// The example event used with `sam local invoke` (an HTTP API v2 event).
function fetchEvent(ticketId?: string): APIGatewayProxyEventV2WithJWTAuthorizer {
  const path = join(__dirname, '../../../events/fetch-ticket.json');
  const event = JSON.parse(readFileSync(path, 'utf8')) as APIGatewayProxyEventV2WithJWTAuthorizer;
  return { ...event, queryStringParameters: ticketId === undefined ? undefined : { ticketId } };
}

function withClaims(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  claims: Record<string, string>,
): APIGatewayProxyEventV2WithJWTAuthorizer {
  const authorizer = { ...event.requestContext.authorizer, jwt: { ...event.requestContext.authorizer.jwt, claims } };
  return { ...event, requestContext: { ...event.requestContext, authorizer } };
}

function storedTicket(fields: Record<string, unknown>) {
  return {
    id: TICKET_ID,
    userId: USER_ID,
    content: 'How do I invite a teammate to my board?',
    urgency: 'LOW',
    createdAt: '2026-10-27T10:00:00Z',
    ...fields,
  };
}

describe('fetch-support-ticket', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it.each([
    ['no ticketId', undefined, 'ticketId is required'],
    ['a ticketId that is not a UUID', 'abc', 'ticketId must be a UUID'],
    ['an oversized ticketId', 'x'.repeat(5000), 'ticketId must be a UUID'],
  ])('returns 400 for %s, without reading DynamoDB', async (_label, ticketId, message) => {
    const result = await handler(fetchEvent(ticketId), lambdaContext);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body!)).toEqual({ message });
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('returns 401 when the token has no sub, without reading DynamoDB', async () => {
    const result = await handler(withClaims(fetchEvent(TICKET_ID), {}), lambdaContext);

    expect(result.statusCode).toBe(401);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it("returns the same 404 for another user's ticket as for a missing one", async () => {
    ddbMock.on(GetCommand).resolves({ Item: storedTicket({ status: 'PROCESSED', userId: 'auth0|someone-else' }) });

    const result = await handler(fetchEvent(TICKET_ID), lambdaContext);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body!)).toEqual({ message: 'ticket not found' });
  });

  it('reads the ticket by id only, without its content', async () => {
    ddbMock.on(GetCommand).resolves({ Item: storedTicket({ status: 'RECEIVED' }) });

    await handler(fetchEvent(TICKET_ID), lambdaContext);

    const get = ddbMock.commandCalls(GetCommand)[0].args[0].input;
    expect(get.Key).toEqual({ id: TICKET_ID });
    expect(get.ProjectionExpression).not.toContain('content');
  });

  it('returns 404 for a ticket that does not exist', async () => {
    ddbMock.on(GetCommand).resolves({});

    const result = await handler(fetchEvent(TICKET_ID), lambdaContext);

    expect(result.statusCode).toBe(404);
    expect(JSON.parse(result.body!)).toEqual({ message: 'ticket not found' });
  });

  it('returns the status, and no reply yet, while the ticket is being processed', async () => {
    ddbMock.on(GetCommand).resolves({ Item: storedTicket({ status: 'RECEIVED' }) });

    const result = await handler(fetchEvent(TICKET_ID), lambdaContext);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      ticketId: TICKET_ID,
      status: 'RECEIVED',
      createdAt: '2026-10-27T10:00:00Z',
    });
  });

  it('returns the reply once the ticket is processed, without the urgency', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: storedTicket({
        status: 'PROCESSED',
        analytics: { urgency: 'LOW', response: 'Open the board and click Invite.' },
      }),
    });

    const result = await handler(fetchEvent(TICKET_ID), lambdaContext);

    expect(JSON.parse(result.body!)).toEqual({
      ticketId: TICKET_ID,
      status: 'PROCESSED',
      createdAt: '2026-10-27T10:00:00Z',
      response: 'Open the board and click Invite.',
    });
  });

  it('returns FAILED without the internal reason', async () => {
    ddbMock.on(GetCommand).resolves({
      Item: storedTicket({
        status: 'FAILED',
        failure: { errorName: 'ValidationException', message: 'bad model' },
      }),
    });

    const result = await handler(fetchEvent(TICKET_ID), lambdaContext);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body!)).toEqual({
      ticketId: TICKET_ID,
      status: 'FAILED',
      createdAt: '2026-10-27T10:00:00Z',
    });
  });

  it('returns 500 when DynamoDB fails', async () => {
    ddbMock.on(GetCommand).rejects(new Error('DynamoDB unavailable'));

    const result = await handler(fetchEvent(TICKET_ID), lambdaContext);

    expect(result.statusCode).toBe(500);
  });
});
