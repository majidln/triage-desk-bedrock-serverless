// Part 1: submit every ticket to the API, a few at a time.

import { API_URL, CONCURRENCY } from './config.ts';
import type { Submission, Ticket } from './types.ts';

export async function submitTicket(ticket: Ticket): Promise<Submission> {
  const start = performance.now();
  try {
    const res = await fetch(`${API_URL}/support-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Only the content: the pipeline must never see the answer key.
      body: JSON.stringify({ content: ticket.content }),
      signal: AbortSignal.timeout(10_000),
    });
    const ackMs = performance.now() - start;
    const text = await res.text();

    if (res.status !== 202) {
      return { ticket, status: res.status, ackMs, error: text.slice(0, 200) };
    }
    const body = JSON.parse(text) as { ticketId?: string };
    if (!body.ticketId) {
      return { ticket, status: res.status, ackMs, error: '202 without ticketId' };
    }
    return { ticket, ticketId: body.ticketId, status: res.status, ackMs };
  } catch (err) {
    // Network error, timeout or unparseable body: a result, not a crash.
    return { ticket, status: 0, ackMs: performance.now() - start, error: (err as Error).message };
  }
}

export async function submitAll(tickets: Ticket[]): Promise<Submission[]> {
  const results: Submission[] = new Array(tickets.length);
  let next = 0;

  // Each worker takes the next ticket until none are left, so at most
  // CONCURRENCY requests are in flight. Results land at the ticket's index.
  async function worker() {
    while (next < tickets.length) {
      const i = next++;
      results[i] = await submitTicket(tickets[i]);
      process.stdout.write(results[i].ticketId ? '.' : 'x');
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tickets.length) }, worker));
  process.stdout.write('\n');
  return results;
}
