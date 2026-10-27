import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { readFileSync } from 'fs';
import { join } from 'path';
import { handler } from '../../handlers/support-request-receiver';

// uuid v13 is ESM-only, which this Jest setup can't load; a fixed id also makes the assertions exact.
jest.mock('uuid', () => ({ v4: () => 'test-ticket-id' }));

const ddbMock = mockClient(DynamoDBDocumentClient);
const sqsMock = mockClient(SQSClient);

const lambdaContext = { functionName: 'triage-desk-ReceiverFunction', awsRequestId: 'test-request-id' } as Context;

// The example event used with `sam local invoke` (an HTTP API v2 event).
function exampleEvent(): APIGatewayProxyEventV2 {
    const path = join(__dirname, '../../../events/new-ticket.json');
    return JSON.parse(readFileSync(path, 'utf8')) as APIGatewayProxyEventV2;
}

function withBody(body: string | undefined): APIGatewayProxyEventV2 {
    return { ...exampleEvent(), body };
}

describe('support-request-receiver', () => {
    beforeEach(() => {
        ddbMock.reset();
        sqsMock.reset();
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
    ])('returns 400 for %s, and touches neither DynamoDB nor SQS', async (_label, body, message) => {
        const result = await handler(withBody(body), lambdaContext);

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body!)).toEqual({ message });
        expect(ddbMock.calls()).toHaveLength(0);
        expect(sqsMock.calls()).toHaveLength(0);
    });

    it('stores and queues the ticket from the example event', async () => {
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
        });
        expect(put.Item?.createdAt).toBe(put.Item?.updatedAt);

        const sent = sqsMock.commandCalls(SendMessageCommand)[0].args[0].input;
        expect(JSON.parse(sent.MessageBody!)).toEqual({ ticketId, content: 'How do I invite a teammate to my board?' });
    });

    it('returns 500 when DynamoDB fails', async () => {
        ddbMock.on(PutCommand).rejects(new Error('DynamoDB unavailable'));

        const result = await handler(exampleEvent(), lambdaContext);

        expect(result.statusCode).toBe(500);
        expect(sqsMock.calls()).toHaveLength(0);
    });
});
