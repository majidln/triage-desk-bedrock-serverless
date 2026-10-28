// Part 4: Bedrock token usage from CloudWatch, and the cost per ticket.
// The only file that knows about CloudWatch.

import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { MINUTE_MS, PRICE_PER_M_INPUT, PRICE_PER_M_OUTPUT, REGION } from './config.ts';
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

export function costPerTicket(usage: BedrockUsage, tickets: number): number {
  const cost = (usage.inputTokens * PRICE_PER_M_INPUT + usage.outputTokens * PRICE_PER_M_OUTPUT) / 1_000_000;
  return ratio(cost, tickets);
}
