import { describe, expect, it, beforeEach } from '@jest/globals';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
    BedrockRuntimeClient,
    InvokeModelCommand,
    ThrottlingException,
    ValidationException,
} from '@aws-sdk/client-bedrock-runtime';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { mockClient } from 'aws-sdk-client-mock';
import { readFileSync } from 'fs';
import { join } from 'path';
import { handler } from '../../handlers/support-request-processor';

const ddbMock = mockClient(DynamoDBDocumentClient);
const bedrockMock = mockClient(BedrockRuntimeClient);
const snsMock = mockClient(SNSClient);

// The example record used with `sam local invoke`, copied with its own messageId and ticketId.
function exampleRecord(n: number): SQSRecord {
    const path = join(__dirname, '../../../events/sqs-event.json');
    const record = (JSON.parse(readFileSync(path, 'utf8')) as SQSEvent).Records[0];
    return {
        ...record,
        messageId: `msg-${n}`,
        body: JSON.stringify({ ticketId: `ticket-${n}`, content: `Question ${n}` }),
    };
}

// A Nova response body, as InvokeModel returns it.
function novaText(text: string) {
    const body = { output: { message: { content: [{ text }] } } };
    return { body: new TextEncoder().encode(JSON.stringify(body)) } as never;
}

function novaResponse(answer: object) {
    return novaText(JSON.stringify(answer));
}

// What the SDK passes to its exception constructors.
const sdkError = { message: 'test', $metadata: {} };

describe('support-request-processor', () => {
    beforeEach(() => {
        ddbMock.reset();
        bedrockMock.reset();
        snsMock.reset();
        bedrockMock.on(InvokeModelCommand).resolves(novaResponse({ urgency: 'HIGH', response: 'Here is how.' }));
    });

    it('reports only the failed record in a batch of 3, and finishes the others once', async () => {
        ddbMock.on(UpdateCommand).resolves({});
        ddbMock.on(UpdateCommand, { Key: { id: 'ticket-2' } }).rejects(new Error('DynamoDB unavailable'));
        const event: SQSEvent = { Records: [exampleRecord(1), exampleRecord(2), exampleRecord(3)] };

        const result = await handler(event);

        expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-2' }] });

        // record 3 was still processed after record 2 failed
        const updated = ddbMock.commandCalls(UpdateCommand).map((c) => c.args[0].input.Key?.id);
        expect(updated).toEqual(['ticket-1', 'ticket-2', 'ticket-3']);

        // the failed ticket was never announced; the others exactly once
        const published = snsMock.commandCalls(PublishCommand).map((c) => c.args[0].input.Message);
        expect(published).toHaveLength(2);
        expect(published[0]).toContain('ticket-1');
        expect(published[1]).toContain('ticket-3');
    });

    it('returns an empty failure list when every record succeeds', async () => {
        ddbMock.on(UpdateCommand).resolves({});
        const event: SQSEvent = { Records: [exampleRecord(1), exampleRecord(2), exampleRecord(3)] };

        const result = await handler(event);

        expect(result).toEqual({ batchItemFailures: [] });
        expect(snsMock.commandCalls(PublishCommand)).toHaveLength(3);
    });

    it('retries a transient Bedrock error without writing or notifying', async () => {
        bedrockMock.on(InvokeModelCommand).rejects(new ThrottlingException(sdkError));

        const result = await handler({ Records: [exampleRecord(1)] });

        expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
        expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
        expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    });

    it('marks the ticket FAILED on a permanent Bedrock error, without a retry', async () => {
        bedrockMock.on(InvokeModelCommand).rejects(new ValidationException(sdkError));
        ddbMock.on(UpdateCommand).resolves({});

        const result = await handler({ Records: [exampleRecord(1)] });

        expect(result).toEqual({ batchItemFailures: [] });
        const values = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues;
        expect(values?.[':status']).toBe('FAILED');
        expect(values?.[':failure']).toMatchObject({ errorName: 'ValidationException' });
        expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    });

    it.each([
        ['not JSON', 'Sorry, I cannot help with that.'],
        ['an invalid urgency', JSON.stringify({ urgency: 'URGENT', response: 'Here is how.' })],
        ['no response', JSON.stringify({ urgency: 'LOW' })],
    ])('marks the ticket FAILED when the model answer is %s', async (_label, text) => {
        bedrockMock.on(InvokeModelCommand).resolves(novaText(text));
        ddbMock.on(UpdateCommand).resolves({});

        const result = await handler({ Records: [exampleRecord(1)] });

        expect(result).toEqual({ batchItemFailures: [] });
        const values = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues;
        expect(values?.[':status']).toBe('FAILED');
        expect(values?.[':failure']).toMatchObject({ errorName: 'PermanentError' });
    });

    it('retries when marking the ticket FAILED itself fails', async () => {
        bedrockMock.on(InvokeModelCommand).rejects(new ValidationException(sdkError));
        ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB unavailable'));

        const result = await handler({ Records: [exampleRecord(1)] });

        expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
    });

    it('drops a poisoned message without a retry, and processes the rest of the batch', async () => {
        ddbMock.on(UpdateCommand).resolves({});
        const poisoned = { ...exampleRecord(2), body: 'not json' };

        const result = await handler({ Records: [exampleRecord(1), poisoned, exampleRecord(3)] });

        expect(result).toEqual({ batchItemFailures: [] });
        expect(bedrockMock.commandCalls(InvokeModelCommand)).toHaveLength(2);
        expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2);
    });
});
