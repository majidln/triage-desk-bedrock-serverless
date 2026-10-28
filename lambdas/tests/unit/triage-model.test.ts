import { describe, expect, it } from '@jest/globals';
import { PermanentError } from '../../shared/classify-error';
import { buildPrompt, parseModelAnswer } from '../../shared/triage-model';

describe('buildPrompt', () => {
    it('includes the ticket and every urgency level', () => {
        const prompt = buildPrompt('My board is gone');

        expect(prompt).toContain('Ticket: My board is gone');
        expect(prompt).toContain('LOW, MEDIUM, HIGH, CRITICAL');
    });
});

describe('parseModelAnswer', () => {
    it('reads a plain JSON answer', () => {
        const answer = JSON.stringify({ urgency: 'CRITICAL', response: 'We are on it.' });

        expect(parseModelAnswer(answer)).toEqual({ urgency: 'CRITICAL', response: 'We are on it.' });
    });

    it('finds the JSON when the model wraps it in text or a code fence', () => {
        const answer = 'Here is my analysis:\n```json\n{"urgency": "LOW", "response": "Try this."}\n```';

        expect(parseModelAnswer(answer)).toEqual({ urgency: 'LOW', response: 'Try this.' });
    });

    it.each([
        ['no JSON at all', 'I cannot help with that.'],
        ['broken JSON', '{"urgency": "LOW", '],
        ['an unknown urgency', '{"urgency": "URGENT", "response": "Hi"}'],
        ['a lowercase urgency', '{"urgency": "low", "response": "Hi"}'],
        ['a missing response', '{"urgency": "LOW"}'],
        ['an empty response', '{"urgency": "LOW", "response": "   "}'],
    ])('rejects %s as a PermanentError', (_label, answer) => {
        expect(() => parseModelAnswer(answer)).toThrow(PermanentError);
    });
});
