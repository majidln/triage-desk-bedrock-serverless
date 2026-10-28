import { describe, expect, it, beforeEach } from '@jest/globals';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { readFileSync } from 'fs';
import { join } from 'path';
import { handler } from '../../handlers/fetch-support-ticket';

const ddbMock = mockClient(DynamoDBDocumentClient);

const lambdaContext = { functionName: 'triage-desk-FetchFunction', awsRequestId: 'test-request-id' } as Context;

// The ticket id in events/fetch-ticket.json
const TICKET_ID = '11111111-2222-3333-4444-555555555555';

// The example event used with `sam local invoke` (an HTTP API v2 event).
function fetchEvent(ticketId?: string): APIGatewayProxyEventV2 {
  const path = join(__dirname, '../../../events/fetch-ticket.json');
  const event = JSON.parse(readFileSync(path, 'utf8')) as APIGatewayProxyEventV2;
  return { ...event, queryStringParameters: ticketId === undefined ? undefined : { ticketId } };
}

function storedTicket(fields: Record<string, unknown>) {
  return {
    id: TICKET_ID,
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
    expect(JSON.parse(result.body!)).toEqual({ ticketId: TICKET_ID, status: 'RECEIVED' });
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
    expect(JSON.parse(result.body!)).toEqual({ ticketId: TICKET_ID, status: 'FAILED' });
  });

  it('returns 500 when DynamoDB fails', async () => {
    ddbMock.on(GetCommand).rejects(new Error('DynamoDB unavailable'));

    const result = await handler(fetchEvent(TICKET_ID), lambdaContext);

    expect(result.statusCode).toBe(500);
  });
});
