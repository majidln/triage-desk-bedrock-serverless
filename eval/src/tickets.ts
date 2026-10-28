// Loading the evaluation set: one JSON ticket per line, ids must be unique.

import { readFile } from 'node:fs/promises';
import type { Ticket } from './types.ts';

export async function loadTickets(path: string): Promise<Ticket[]> {
  const content = await readFile(path, { encoding: 'utf8' });
  const tickets: Ticket[] = [];
  const seen = new Set<string>();

  content.split('\n').forEach((line, i) => {
    if (line.trim() === '') return;

    let ticket: Ticket;
    try {
      ticket = JSON.parse(line) as Ticket;
    } catch (err) {
      throw new Error(`${path} line ${i + 1}: ${(err as Error).message}`);
    }

    if (seen.has(ticket.id)) {
      throw new Error(`${path} line ${i + 1}: duplicate ticket id ${ticket.id}`);
    }
    seen.add(ticket.id);
    tickets.push(ticket);
  });

  return tickets;
}
