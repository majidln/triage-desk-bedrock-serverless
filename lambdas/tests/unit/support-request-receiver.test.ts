import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { APIGatewayProxyEvent } from 'aws-lambda';
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

// The example event used with `sam local invoke` (an HTTP API v2 event).
function exampleEvent(): APIGatewayProxyEvent {
    const path = join(__dirname, '../../../events/new-ticket.json');
    return JSON.parse(readFileSync(path, 'utf8')) as APIGatewayProxyEvent;
}

describe('support-request-receiver', () => {
    beforeEach(() => {
        ddbMock.reset();
        sqsMock.reset();
    });

    it('returns 400 and touches neither DynamoDB nor SQS when content is missing', async () => {
        const event = { ...exampleEvent(), body: JSON.stringify({}) };

        const result = await handler(event);

        expect(result.statusCode).toBe(400);
        expect(JSON.parse(result.body)).toEqual({ message: 'content is required' });
        expect(ddbMock.calls()).toHaveLength(0);
        expect(sqsMock.calls()).toHaveLength(0);
    });

    it('stores and queues the ticket from the example event', async () => {
        const result = await handler(exampleEvent());

        expect(result.statusCode).toBe(202);
        const { ticketId } = JSON.parse(result.body);
        expect(ticketId).toBe('test-ticket-id');

        const put = ddbMock.commandCalls(PutCommand)[0].args[0].input;
        expect(put.Item).toMatchObject({
            id: ticketId,
            status: 'RECEIVED',
            content: 'How do I invite a teammate to my board?',
        });

        const sent = sqsMock.commandCalls(SendMessageCommand)[0].args[0].input;
        expect(JSON.parse(sent.MessageBody!)).toEqual({ ticketId, content: 'How do I invite a teammate to my board?' });
    });
});
