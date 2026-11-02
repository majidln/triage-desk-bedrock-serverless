import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { APIGatewayProxyEventV2WithJWTAuthorizer, Context } from 'aws-lambda';
import { ApplyGuardrailCommand, BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { readFileSync } from 'fs';
import { join } from 'path';
import { handler, MAX_BODY_BYTES, MAX_CONTENT_LENGTH } from '../../handlers/support-request-receiver';

// uuid v13 is ESM-only, which this Jest setup can't load; a fixed id also makes the assertions exact.
jest.mock('uuid', () => ({ v4: () => 'test-ticket-id' }));

const ddbMock = mockClient(DynamoDBDocumentClient);
const bedrockMock = mockClient(BedrockRuntimeClient);

const lambdaContext = { functionName: 'triage-desk-ReceiverFunction', awsRequestId: 'test-request-id' } as Context;

// The caller (the token's `sub`) in events/new-ticket.json
const USER_ID = 'auth0|test-user';

// The example event used with `sam local invoke` (an HTTP API v2 event).
function exampleEvent(): APIGatewayProxyEventV2WithJWTAuthorizer {
  const path = join(__dirname, '../../../events/new-ticket.json');
  return JSON.parse(readFileSync(path, 'utf8')) as APIGatewayProxyEventV2WithJWTAuthorizer;
}

function withBody(body: string | undefined): APIGatewayProxyEventV2WithJWTAuthorizer {
  return { ...exampleEvent(), body };
}

function withClaims(claims: Record<string, string>): APIGatewayProxyEventV2WithJWTAuthorizer {
  const event = exampleEvent();
  const authorizer = { ...event.requestContext.authorizer, jwt: { ...event.requestContext.authorizer.jwt, claims } };
  return { ...event, requestContext: { ...event.requestContext, authorizer } };
}

describe('support-request-receiver', () => {
  beforeEach(() => {
    ddbMock.reset();
    bedrockMock.reset();
    bedrockMock.on(ApplyGuardrailCommand).resolves({ action: 'NONE', outputs: [], assessments: [] });
  });

  it.each([
    ['no body', undefined, 'body must be JSON'],
    ['invalid JSON', '{content: "hi"', 'body must be JSON'],
    ['a JSON string', '"hello"', 'body must be a JSON object'],
    ['null', 'null', 'body must be a JSON object'],
    ['an array', '[]', 'body must be a JSON object'],
    ['no content', '{}', 'content is required'],
    ['a number as content', '{"content": 42}', 'content is required'],
    ['blank content', '{"content": "   "}', 'content is required'],
  ])('returns 400 for %s, without writing the ticket', async (_label, body, message) => {
    const result = await handler(withBody(body), lambdaContext);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body!)).toEqual({ message });
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it.each([
    ['content over the limit', JSON.stringify({ content: 'x'.repeat(MAX_CONTENT_LENGTH + 1) })],
    ['a body over the limit', JSON.stringify({ content: 'hi', padding: 'x'.repeat(MAX_BODY_BYTES) })],
  ])('returns 413 for %s, without writing the ticket', async (_label, body) => {
    const result = await handler(withBody(body), lambdaContext);

    expect(result.statusCode).toBe(413);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('accepts content of exactly the maximum length', async () => {
    const result = await handler(withBody(JSON.stringify({ content: 'x'.repeat(MAX_CONTENT_LENGTH) })), lambdaContext);

    expect(result.statusCode).toBe(202);
  });

  it('returns 401 when the token has no sub, without writing the ticket', async () => {
    const result = await handler(withClaims({}), lambdaContext);

    expect(result.statusCode).toBe(401);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('stores the ticket from the example event, in one write', async () => {
    const result = await handler(exampleEvent(), lambdaContext);

    expect(result.statusCode).toBe(202);
    expect(result.headers).toEqual({ 'content-type': 'application/json' });
    const { ticketId } = JSON.parse(result.body!);
    expect(ticketId).toBe('test-ticket-id');

    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.Item).toMatchObject({
      id: ticketId,
      status: 'RECEIVED',
      content: 'How do I invite a teammate to my board?',
      userId: USER_ID,
    });
    expect(put.Item?.createdAt).toBe(put.Item?.updatedAt);
    // The table's stream and the intake pipe queue it: the receiver makes no other call
    expect(ddbMock.calls()).toHaveLength(1);
  });

  it('stores the caller from the token as the userId, not one sent in the body', async () => {
    const body = JSON.stringify({ content: 'Hello', customerId: 'someone-else', userId: 'someone-else' });

    await handler(withBody(body), lambdaContext);

    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.Item?.userId).toBe(USER_ID);
    expect(put.Item).not.toHaveProperty('customerId');
  });

  it('stores only the masked text', async () => {
    bedrockMock.on(ApplyGuardrailCommand).resolves({
      action: 'GUARDRAIL_INTERVENED',
      outputs: [{ text: 'My card is {CREDIT_DEBIT_CARD_NUMBER}' }],
      assessments: [
        {
          sensitiveInformationPolicy: {
            regexes: [],
            piiEntities: [
              { type: 'CREDIT_DEBIT_CARD_NUMBER', match: '4111 1111 1111 1111', action: 'ANONYMIZED', detected: true },
            ],
          },
        },
      ],
    });

    await handler(withBody(JSON.stringify({ content: 'My card is 4111 1111 1111 1111' })), lambdaContext);

    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.Item?.content).toBe('My card is {CREDIT_DEBIT_CARD_NUMBER}');
    expect(JSON.stringify(put.Item)).not.toContain('4111');
  });

  it("stores the guardrail's findings with the ticket", async () => {
    bedrockMock.on(ApplyGuardrailCommand).resolves({
      action: 'NONE',
      outputs: [],
      assessments: [
        { contentPolicy: { filters: [{ type: 'PROMPT_ATTACK', confidence: 'HIGH', action: 'NONE', detected: true }] } },
      ],
    });

    const result = await handler(exampleEvent(), lambdaContext);

    expect(result.statusCode).toBe(202);
    const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
    expect(put.Item?.guardrail).toEqual({
      flags: ['PROMPT_ATTACK'],
      piiTypes: [],
      version: '1',
      checkedAt: put.Item?.createdAt,
    });
  });

  it('returns 503 and stores nothing when the guardrail fails', async () => {
    bedrockMock.on(ApplyGuardrailCommand).rejects(new Error('Bedrock unavailable'));

    const result = await handler(exampleEvent(), lambdaContext);

    expect(result.statusCode).toBe(503);
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('checks a ticket only after the request is valid', async () => {
    await handler(withBody('{}'), lambdaContext);

    expect(bedrockMock.calls()).toHaveLength(0);
  });

  it('returns 500 when DynamoDB fails', async () => {
    ddbMock.on(PutCommand).rejects(new Error('DynamoDB unavailable'));

    const result = await handler(exampleEvent(), lambdaContext);

    expect(result.statusCode).toBe(500);
  });
});
