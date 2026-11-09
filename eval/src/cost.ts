// Part 4: Bedrock token usage from CloudWatch, and the cost per ticket.
// The only file that knows about CloudWatch.

import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
// One price table for the pipeline and the evaluation, so they can't disagree.
import type { ModelPrice } from '../../lambdas/shared/model-prices.ts';
export { priceFor } from '../../lambdas/shared/model-prices.ts';
import { DEFAULT_MODEL_ID, MINUTE_MS, REGION } from './config.ts';
import type { Collected } from './types.ts';
import { ratio } from './util.ts';

const cloudwatch = new CloudWatchClient({ region: REGION });

// v0 doesn't store token counts (gap G12), so we read the per-minute metrics
// Bedrock publishes to CloudWatch. They are account-wide: run nothing else on
// this model during an evaluation.
export interface BedrockUsage {
  invocations: number;
  inputTokens: number;
  outputTokens: number;
  throttles: number;
}

// Sum of one Bedrock metric for the model over [start, end), 0 if there are no datapoints.
export async function sumMetric(metric: string, modelId: string, start: Date, end: Date): Promise<number> {
  const res = await cloudwatch.send(
    new GetMetricStatisticsCommand({
      Namespace: 'AWS/Bedrock',
      MetricName: metric,
      Dimensions: [{ Name: 'ModelId', Value: modelId }],
      StartTime: start,
      EndTime: end,
      Period: 60,
      Statistics: ['Sum'],
    }),
  );
  return (res.Datapoints ?? []).reduce((sum, d) => sum + (d.Sum ?? 0), 0);
}

export async function bedrockUsage(modelId: string, start: Date, end: Date): Promise<BedrockUsage> {
  // Metrics are per minute, and a run can cross a minute boundary: widen to whole minutes.
  const from = new Date(Math.floor(start.getTime() / MINUTE_MS) * MINUTE_MS);
  const to = new Date(Math.ceil(end.getTime() / MINUTE_MS) * MINUTE_MS);
  const [invocations, inputTokens, outputTokens, throttles] = await Promise.all(
    ['Invocations', 'InputTokenCount', 'OutputTokenCount', 'InvocationThrottles'].map((m) =>
      sumMetric(m, modelId, from, to),
    ),
  );
  return { invocations, inputTokens, outputTokens, throttles };
}

// Metrics arrive 1-3 minutes late. Re-read every 30 s until the invocation count
// has stopped changing, or give up after 5 minutes.
export async function waitForUsage(modelId: string, start: Date, end: Date): Promise<BedrockUsage> {
  const deadline = Date.now() + 5 * MINUTE_MS;
  let usage = await bedrockUsage(modelId, start, end);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30_000));
    const next = await bedrockUsage(modelId, start, end);
    process.stdout.write(`\r  invocations seen: ${next.invocations}`);
    if (next.invocations > 0 && next.invocations === usage.invocations) break;
    usage = next;
  }
  process.stdout.write('\n');
  return usage;
}

// The model the deployed stack called, as the tickets recorded it. Flagged tickets record
// "none" (they never reach a model), so they don't count. Several models in one run means
// the stack was redeployed mid-run: the numbers would mix two models, so stop.
export function runModelId(collected: Collected[]): string {
  const ids = new Set(collected.flatMap((c) => c.usage?.modelId ?? []).filter((id) => id !== 'none'));
  if (ids.size > 1) throw new Error(`Tickets used more than one model: ${[...ids].join(', ')}`);
  return ids.values().next().value ?? DEFAULT_MODEL_ID;
}

// undefined when the model has no price: an unknown cost must never read as $0.
export function costPerTicket(usage: BedrockUsage, tickets: number, price?: ModelPrice): number | undefined {
  if (price === undefined) return undefined;
  const cost = (usage.inputTokens * price.inputPerM + usage.outputTokens * price.outputPerM) / 1_000_000;
  return ratio(cost, tickets);
}

// From Step 2 the pipeline records tokens and cost on each ticket, so the evaluation can read
// them there: no time window, no waiting for metrics, nothing else on the account counted.
export interface TicketCost {
  withUsage: number; // tickets with a usage record
  priced: number; // of those, tickets with a cost (the model had a price)
  inputTokens: number;
  outputTokens: number;
  costUsd: number; // sum over the priced tickets
}

export function ticketCost(collected: Collected[]): TicketCost {
  const usages = collected.flatMap((c) => (c.usage ? [c.usage] : []));
  const priced = usages.filter((u) => u.costUsd !== undefined);
  return {
    withUsage: usages.length,
    priced: priced.length,
    inputTokens: usages.reduce((sum, u) => sum + (u.inputTokens ?? 0), 0),
    outputTokens: usages.reduce((sum, u) => sum + (u.outputTokens ?? 0), 0),
    costUsd: priced.reduce((sum, u) => sum + u.costUsd!, 0),
  };
}

// Cost per ticket from the tickets themselves, or undefined when it isn't known for all of
// them: a missing cost must never read as a cheaper model.
export function ticketCostPerTicket(cost: TicketCost): number | undefined {
  return cost.withUsage > 0 && cost.priced === cost.withUsage ? ratio(cost.costUsd, cost.priced) : undefined;
}
