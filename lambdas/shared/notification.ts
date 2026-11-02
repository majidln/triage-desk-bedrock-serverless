// The support team's email about a triaged ticket. An email leaves AWS for good (inboxes,
// forwards, backups), so it carries as little as it can: never the full ticket or the draft
// reply, only a short excerpt of the masked text. The full ticket stays in the table.
// Step 6 replaces this email with a Slack message.
import { SupportTicketMessage, TicketTriage } from './types';

// How much of the ticket the email shows: enough for an agent to judge it at a glance.
export const EXCERPT_LENGTH = 200;

// Shown in inbox lists and phone notifications, so never any ticket text.
export function notificationSubject(message: SupportTicketMessage, triage: TicketTriage): string {
  return `[${triage.urgency}] Support ticket ${message.ticketId}`;
}

export function notificationBody(message: SupportTicketMessage, triage: TicketTriage): string {
  const excerpt =
    message.content.length > EXCERPT_LENGTH ? `${message.content.slice(0, EXCERPT_LENGTH)}…` : message.content;
  const lines = [`Ticket: ${message.ticketId}`, `Urgency: ${triage.urgency}`];
  // Why a flagged ticket has no real draft, and that it needs a person
  if (message.flags.length > 0) {
    lines.push(`Flagged by the guardrail, needs review: ${message.flags.join(', ')}`);
  }
  lines.push('', `Excerpt (masked): ${excerpt}`, '', 'The full ticket and the draft reply are in the tickets table.');
  return lines.join('\n');
}
