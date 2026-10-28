import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { Context, SQSEvent, SQSRecord } from 'aws-lambda';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
    BedrockRuntimeClient,
    ConverseCommand,
    ThrottlingException,
    ValidationException,
} from '@aws-sdk/client-bedrock-runtime';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { readFileSync } from 'fs';
import { join } from 'path';
import { handler, processRecord } from '../../handlers/support-request-processor';
import { logger } from '../../shared/logger';

const ddbMock = mockClient(DynamoDBDocumentClient);
const bedrockMock = mockClient(BedrockRuntimeClient);
const snsMock = mockClient(SNSClient);

// The example record used with `sam local invoke`: one SQS message holding one DynamoDB
// stream record, as the intake pipe sends it.
function sampleRecord(): SQSRecord {
    const path = join(__dirname, '../../../events/sqs-event.json');
    return (JSON.parse(readFileSync(path, 'utf8')) as SQSEvent).Records[0];
}

// The example record, for a different ticket and with its own messageId.
function exampleRecord(n: number): SQSRecord {
    return { ...sampleRecord(), messageId: `msg-${n}`, body: ticketMessage(`ticket-${n}`, `Question ${n}`) };
}

// A stream record body for a new ticket, built from the example so it keeps the real shape.
function ticketMessage(ticketId: string, content: string): string {
    const record = JSON.parse(sampleRecord().body);
    record.dynamodb.Keys = marshall({ id: ticketId });
    record.dynamodb.NewImage = { ...record.dynamodb.NewImage, ...marshall({ id: ticketId, content }) };
    return JSON.stringify(record);
}

// A Converse response whose answer is this text.
function converseText(text: string) {
    return converseContent([{ text }]);
}

function converseResponse(answer: object) {
    return converseText(JSON.stringify(answer));
}

function converseContent(content: object[], stopReason = 'end_turn') {
    return {
        output: { message: { role: 'assistant', content } },
        stopReason,
        usage: { inputTokens: 86, outputTokens: 185, totalTokens: 271 },
    } as never;
}

// Just enough of a Lambda context for the logger and the time check: a fresh 60 s invocation.
const lambdaContext = contextWithRemaining(60_000);

function contextWithRemaining(...remainingMs: number[]): Context {
    const clock = jest.fn<() => number>();
    remainingMs.forEach((ms) => clock.mockReturnValueOnce(ms));
    clock.mockReturnValue(remainingMs[remainingMs.length - 1]);
    return {
        functionName: 'triage-desk-ProcessorFunction',
        awsRequestId: 'test-request-id',
        getRemainingTimeInMillis: clock,
    } as unknown as Context;
}

// The status changes (RECEIVED → PROCESSED or FAILED), not the notifiedAt writes.
function guardedUpdates() {
    return ddbMock
        .commandCalls(UpdateCommand)
        .map((c) => c.args[0].input)
        .filter((input) => input.ConditionExpression);
}

// What DynamoDB throws when the ticket is no longer RECEIVED: the current item, or none
// when the ticket doesn't exist.
function alreadyMovedOn(item?: Record<string, unknown>) {
    return new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        $metadata: {},
        Item: item ? marshall(item) : undefined,
    });
}

// What the SDK passes to its exception constructors.
const sdkError = { message: 'test', $metadata: {} };

describe('support-request-processor', () => {
    beforeEach(() => {
        ddbMock.reset();
        bedrockMock.reset();
        snsMock.reset();
        bedrockMock.on(ConverseCommand).resolves(converseResponse({ urgency: 'HIGH', response: 'Here is how.' }));
    });

    it('reports only the failed record in a batch of 3, and finishes the others once', async () => {
        ddbMock.on(UpdateCommand).resolves({});
        ddbMock.on(UpdateCommand, { Key: { id: 'ticket-2' } }).rejects(new Error('DynamoDB unavailable'));
        const event: SQSEvent = { Records: [exampleRecord(1), exampleRecord(2), exampleRecord(3)] };

        const result = await handler(event, lambdaContext);

        expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-2' }] });

        // record 3 was still processed after record 2 failed
        const updated = guardedUpdates().map((input) => input.Key?.id);
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

        const result = await handler(event, lambdaContext);

        expect(result).toEqual({ batchItemFailures: [] });
        expect(snsMock.commandCalls(PublishCommand)).toHaveLength(3);
    });

    it('retries a transient Bedrock error without writing or notifying', async () => {
        bedrockMock.on(ConverseCommand).rejects(new ThrottlingException(sdkError));

        const result = await handler({ Records: [exampleRecord(1)] }, lambdaContext);

        expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
        expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
        expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
    });

    it('marks the ticket FAILED on a permanent Bedrock error, without a retry', async () => {
        bedrockMock.on(ConverseCommand).rejects(new ValidationException(sdkError));
        ddbMock.on(UpdateCommand).resolves({});

        const result = await handler({ Records: [exampleRecord(1)] }, lambdaContext);

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
        bedrockMock.on(ConverseCommand).resolves(converseText(text));
        ddbMock.on(UpdateCommand).resolves({});

        const result = await handler({ Records: [exampleRecord(1)] }, lambdaContext);

        expect(result).toEqual({ batchItemFailures: [] });
        const values = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues;
        expect(values?.[':status']).toBe('FAILED');
        expect(values?.[':failure']).toMatchObject({ errorName: 'PermanentError' });
    });

    it.each([
        ['no content', converseContent([])],
        ['cut off before any text', converseContent([], 'max_tokens')],
    ])('marks the ticket FAILED, without a retry, when the model returns %s', async (_label, response) => {
        bedrockMock.on(ConverseCommand).resolves(response);
        ddbMock.on(UpdateCommand).resolves({});

        const result = await handler({ Records: [exampleRecord(1)] }, lambdaContext);

        expect(result).toEqual({ batchItemFailures: [] });
        const values = ddbMock.commandCalls(UpdateCommand)[0].args[0].input.ExpressionAttributeValues;
        expect(values?.[':status']).toBe('FAILED');
        expect(values?.[':failure']).toMatchObject({ errorName: 'PermanentError' });
    });

    it('retries when marking the ticket FAILED itself fails', async () => {
        bedrockMock.on(ConverseCommand).rejects(new ValidationException(sdkError));
        ddbMock.on(UpdateCommand).rejects(new Error('DynamoDB unavailable'));

        const result = await handler({ Records: [exampleRecord(1)] }, lambdaContext);

        expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-1' }] });
    });

    it('drops a poisoned message without a retry, and processes the rest of the batch', async () => {
        ddbMock.on(UpdateCommand).resolves({});
        const poisoned = { ...exampleRecord(2), body: 'not json' };

        const result = await handler({ Records: [exampleRecord(1), poisoned, exampleRecord(3)] }, lambdaContext);

        expect(result).toEqual({ batchItemFailures: [] });
        expect(bedrockMock.commandCalls(ConverseCommand)).toHaveLength(2);
        expect(snsMock.commandCalls(PublishCommand)).toHaveLength(2);
    });

    describe('processRecord outcome', () => {
        it("is 'processed' when the ticket is triaged, saved and announced", async () => {
            ddbMock.on(UpdateCommand).resolves({});

            await expect(processRecord(exampleRecord(1))).resolves.toBe('processed');
        });

        it("is 'failed' on a permanent Bedrock error", async () => {
            bedrockMock.on(ConverseCommand).rejects(new ValidationException(sdkError));
            ddbMock.on(UpdateCommand).resolves({});

            await expect(processRecord(exampleRecord(1))).resolves.toBe('failed');
        });

        it("is 'dropped' for a message body that isn't JSON", async () => {
            await expect(processRecord({ ...exampleRecord(1), body: 'not json' })).resolves.toBe('dropped');
        });

        it('throws on a transient Bedrock error, so the record is retried', async () => {
            bedrockMock.on(ConverseCommand).rejects(new ThrottlingException(sdkError));

            await expect(processRecord(exampleRecord(1))).rejects.toThrow(ThrottlingException);
        });
    });

    it('never writes ticket content or the model reply to the logs', async () => {
        const secret = 'my password is hunter2';
        const reply = 'Reset it at example.com';
        // Bedrock is called in batch order: ticket-1 gets an answer, ticket-3 is throttled
        bedrockMock
            .on(ConverseCommand)
            .resolvesOnce(converseResponse({ urgency: 'HIGH', response: reply }))
            .rejectsOnce(new ThrottlingException(sdkError));
        ddbMock.on(UpdateCommand).resolves({});
        const record = { ...exampleRecord(1), body: ticketMessage('ticket-1', secret) };
        const poisoned = { ...exampleRecord(2), body: `not json: ${secret}` };
        const throttled = { ...exampleRecord(3), body: ticketMessage('ticket-3', secret) };
        const spies = (['debug', 'info', 'warn', 'error'] as const).map((level) => jest.spyOn(logger, level));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await handler({ Records: [record, poisoned, throttled] }, lambdaContext);

        const logged = JSON.stringify([...spies, consoleSpy].flatMap((spy) => spy.mock.calls));
        expect(logged).toContain('ticket-1');
        expect(logged).not.toContain('hunter2');
        expect(logged).not.toContain(reply);
        [...spies, consoleSpy].forEach((spy) => spy.mockRestore());
    });

    describe('idempotency', () => {
        it('only moves a ticket on while it is still RECEIVED', async () => {
            ddbMock.on(UpdateCommand).resolves({});

            await processRecord(exampleRecord(1));

            const [save] = guardedUpdates();
            expect(save.ConditionExpression).toBe('#status = :received');
            expect(save.ExpressionAttributeValues?.[':received']).toBe('RECEIVED');
            expect(ddbMock.commandCalls(UpdateCommand)[1].args[0].input.UpdateExpression).toBe(
                'SET notifiedAt = :notifiedAt',
            );
        });

        it('does nothing for a ticket that was already processed and announced', async () => {
            ddbMock
                .on(UpdateCommand)
                .rejects(alreadyMovedOn({ id: 'ticket-1', status: 'PROCESSED', notifiedAt: '2026-10-27T10:00:00Z' }));

            await expect(processRecord(exampleRecord(1))).resolves.toBe('duplicate');
            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
        });

        it('sends the missed email, with the saved triage, when the earlier delivery never announced it', async () => {
            const saved = { urgency: 'CRITICAL', response: 'The answer that was saved.' };
            ddbMock
                .on(UpdateCommand)
                .resolves({})
                .on(UpdateCommand, { ConditionExpression: '#status = :received' })
                .rejects(alreadyMovedOn({ id: 'ticket-1', status: 'PROCESSED', analytics: saved }));

            await expect(processRecord(exampleRecord(1))).resolves.toBe('processed');

            const published = snsMock.commandCalls(PublishCommand);
            expect(published).toHaveLength(1);
            expect(published[0].args[0].input.Subject).toContain('CRITICAL');
            expect(published[0].args[0].input.Message).toContain(saved.response);
        });

        it('never overwrites a processed ticket with FAILED', async () => {
            bedrockMock.on(ConverseCommand).rejects(new ValidationException(sdkError));
            ddbMock
                .on(UpdateCommand)
                .rejects(alreadyMovedOn({ id: 'ticket-1', status: 'PROCESSED', notifiedAt: '2026-10-27T10:00:00Z' }));

            await expect(processRecord(exampleRecord(1))).resolves.toBe('duplicate');
        });

        it("drops a message whose ticket doesn't exist", async () => {
            ddbMock.on(UpdateCommand).rejects(alreadyMovedOn());

            await expect(processRecord(exampleRecord(1))).resolves.toBe('dropped');
            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(0);
        });
    });

    describe('time check', () => {
        it("hands back a ticket it can't finish before the Lambda timeout, without starting it", async () => {
            ddbMock.on(UpdateCommand).resolves({});
            const event: SQSEvent = { Records: [exampleRecord(1), exampleRecord(2), exampleRecord(3)] };

            // 60 s left for the first ticket, then only 20 s: not enough for a worst-case ticket
            const result = await handler(event, contextWithRemaining(60_000, 20_000));

            expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: 'msg-2' }, { itemIdentifier: 'msg-3' }] });
            expect(bedrockMock.commandCalls(ConverseCommand)).toHaveLength(1);
            expect(snsMock.commandCalls(PublishCommand)).toHaveLength(1);
        });

        it('starts a ticket with exactly the worst-case budget left (35 s)', async () => {
            ddbMock.on(UpdateCommand).resolves({});

            const result = await handler({ Records: [exampleRecord(1)] }, contextWithRemaining(35_000));

            expect(result).toEqual({ batchItemFailures: [] });
        });
    });

    describe('reading the stream record', () => {
        it('processes the example event as the intake pipe sends it', async () => {
            ddbMock.on(UpdateCommand).resolves({});

            await expect(processRecord(sampleRecord())).resolves.toBe('processed');

            const [save] = guardedUpdates();
            expect(save.Key).toEqual({ id: '11111111-2222-3333-4444-555555555555' });
            const { messages } = bedrockMock.commandCalls(ConverseCommand)[0].args[0].input;
            expect(messages?.[0].content?.[0].text).toContain('How do I invite a teammate to my board?');
        });

        it.each([
            ['the old hand-made message', JSON.stringify({ ticketId: 'ticket-1', content: 'Question 1' })],
            ['a record without a NewImage', JSON.stringify({ eventName: 'INSERT', dynamodb: {} })],
            ['a record without content', JSON.stringify({ dynamodb: { NewImage: marshall({ id: 'ticket-1' }) } })],
            ['JSON null', 'null'],
        ])('drops %s without calling Bedrock', async (_label, body) => {
            await expect(processRecord({ ...sampleRecord(), body })).resolves.toBe('dropped');
            expect(bedrockMock.commandCalls(ConverseCommand)).toHaveLength(0);
        });
    });
});
