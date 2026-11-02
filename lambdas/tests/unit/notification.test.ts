import { describe, expect, it } from '@jest/globals';
import { EXCERPT_LENGTH, notificationBody, notificationSubject } from '../../shared/notification';
import { Urgency } from '../../shared/types';

const triage = { urgency: Urgency.HIGH, response: 'The draft reply.' };

describe('notificationSubject', () => {
  it('holds the urgency and ticket id, never ticket text', () => {
    const message = { ticketId: 'ticket-1', content: 'My card is {CREDIT_DEBIT_CARD_NUMBER}', flags: [] };

    expect(notificationSubject(message, triage)).toBe('[HIGH] Support ticket ticket-1');
  });
});

describe('notificationBody', () => {
  it('shows the id, urgency and a short excerpt, never the draft reply', () => {
    const body = notificationBody({ ticketId: 'ticket-1', content: 'How do I export?', flags: [] }, triage);

    expect(body).toContain('Ticket: ticket-1');
    expect(body).toContain('Urgency: HIGH');
    expect(body).toContain('Excerpt (masked): How do I export?');
    expect(body).not.toContain('The draft reply.');
  });

  it('cuts a long ticket to the excerpt length', () => {
    const content = 'a'.repeat(EXCERPT_LENGTH) + 'THE REST';

    const body = notificationBody({ ticketId: 'ticket-1', content, flags: [] }, triage);

    expect(body).toContain(`${'a'.repeat(EXCERPT_LENGTH)}…`);
    expect(body).not.toContain('THE REST');
  });

  it('says a flagged ticket needs review', () => {
    const body = notificationBody({ ticketId: 'ticket-1', content: 'Hi', flags: ['PROMPT_ATTACK'] }, triage);

    expect(body).toContain('Flagged by the guardrail, needs review: PROMPT_ATTACK');
  });
});
