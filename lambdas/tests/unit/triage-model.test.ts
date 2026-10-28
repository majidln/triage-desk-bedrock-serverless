import { describe, expect, it } from '@jest/globals';
import { PermanentError } from '../../shared/classify-error';
import { buildPrompt, buildToolConfig, parseModelAnswer } from '../../shared/triage-model';

describe('buildPrompt', () => {
  it('includes the ticket and every urgency level', () => {
    const prompt = buildPrompt('My board is gone');

    expect(prompt).toContain('Ticket: My board is gone');
    expect(prompt).toContain('LOW, MEDIUM, HIGH, CRITICAL');
  });
});

describe('buildToolConfig', () => {
  it('forces the one tool it defines', () => {
    const config = buildToolConfig();

    expect(config.tools).toHaveLength(1);
    expect(config.toolChoice).toEqual({ tool: { name: config.tools?.[0].toolSpec?.name } });
  });

  it('asks for every urgency level and requires both fields', () => {
    const schema = buildToolConfig().tools?.[0].toolSpec?.inputSchema?.json as {
      properties: { urgency: { enum: string[] } };
      required: string[];
    };

    expect(schema.properties.urgency.enum).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    expect(schema.required).toEqual(['urgency', 'response']);
  });
});

describe('parseModelAnswer', () => {
  it('reads the tool input', () => {
    expect(parseModelAnswer({ urgency: 'CRITICAL', response: 'We are on it.' })).toEqual({
      urgency: 'CRITICAL',
      response: 'We are on it.',
    });
  });

  it('keeps only the fields it knows', () => {
    const answer = { urgency: 'LOW', response: 'Try this.', confidence: 0.9 };

    expect(parseModelAnswer(answer)).toEqual({ urgency: 'LOW', response: 'Try this.' });
  });

  it.each([
    ['null', null, 'not an object'],
    ['a string', '{"urgency": "LOW", "response": "Hi"}', 'not an object'],
    ['an array', [{ urgency: 'LOW', response: 'Hi' }], 'not an object'],
    ['an unknown urgency', { urgency: 'URGENT', response: 'Hi' }, 'invalid urgency'],
    ['a lowercase urgency', { urgency: 'low', response: 'Hi' }, 'invalid urgency'],
    ['a missing urgency', { response: 'Hi' }, 'invalid urgency'],
    ['a missing response', { urgency: 'LOW' }, 'no response'],
    ['an empty response', { urgency: 'LOW', response: '   ' }, 'no response'],
    ['a response that is not a string', { urgency: 'LOW', response: 42 }, 'no response'],
  ])('rejects %s as a PermanentError', (_label, input, reason) => {
    expect(() => parseModelAnswer(input)).toThrow(PermanentError);
    expect(() => parseModelAnswer(input)).toThrow(reason);
  });
});
