// Cost read from the tickets (Step 2 on). No AWS needed.
// Run with: npm test

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketCost, ticketCostPerTicket } from '../src/cost.ts';
import type { Collected, TicketUsage } from '../src/types.ts';

function withUsage(usage?: TicketUsage): Collected {
  return { submission: {} as Collected['submission'], outcome: 'processed', usage };
}

test('cost per ticket is the average of the costs the tickets recorded', () => {
  const cost = ticketCost([
    withUsage({ inputTokens: 500, outputTokens: 100, costUsd: 0.00006 }),
    withUsage({ inputTokens: 520, outputTokens: 140, costUsd: 0.00008 }),
  ]);

  assert.deepEqual(
    { ...cost, costUsd: undefined },
    { withUsage: 2, priced: 2, inputTokens: 1020, outputTokens: 240, costUsd: undefined },
  );
  // Sums of decimals aren't exact in floating point: compare to well below a millionth of a cent.
  assert.ok(Math.abs(cost.costUsd - 0.00014) < 1e-12);
  assert.ok(Math.abs(ticketCostPerTicket(cost)! - 0.00007) < 1e-12);
});

test('a ticket without a cost makes the cost unknown, never cheaper', () => {
  const cost = ticketCost([
    withUsage({ inputTokens: 500, outputTokens: 100, costUsd: 0.00006 }),
    withUsage({ inputTokens: 520, outputTokens: 140 }), // the model had no price
  ]);

  assert.equal(cost.priced, 1);
  assert.equal(cost.inputTokens, 1020); // the tokens still count
  assert.equal(ticketCostPerTicket(cost), undefined);
});

test('tickets from before Step 2 have no usage: no ticket cost at all', () => {
  const cost = ticketCost([withUsage(), withUsage()]);

  assert.equal(cost.withUsage, 0);
  assert.equal(ticketCostPerTicket(cost), undefined);
});
