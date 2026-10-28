// Triage Desk evaluation runner.
//
// Usage:
//   API_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com/Dev \
//   TABLE_NAME=<stack-name>-Table \
//   npx tsx run.ts --label v0 [--tickets other.jsonl]
//
// The five parts, in order: submit -> collect -> score -> cost -> report.
// Each lives in src/; this file only runs them in sequence.

import { collectAll } from './src/collect.ts';
import {
  API_URL,
  CONCURRENCY,
  MODEL_ID,
  PRICE_PER_M_INPUT,
  PRICE_PER_M_OUTPUT,
  REGION,
  TABLE_NAME,
} from './src/config.ts';
import { costPerTicket, ticketCost, ticketCostPerTicket, waitForUsage } from './src/cost.ts';
import { printAccuracyBy, printLevels, printMatrix, printRedTeam, printReplyChecks } from './src/print.ts';
import { gitInfo, latency, sha1, ticketRows, writeReport } from './src/report.ts';
import type { Report } from './src/report.ts';
import { redTeamResults } from './src/score/redteam.ts';
import { checkReplies } from './src/score/replies.ts';
import { accuracyBy, confusionMatrix, scoreAccuracy, scoreLevels } from './src/score/urgency.ts';
import { submitAll } from './src/submit.ts';
import { loadTickets } from './src/tickets.ts';
import type { Outcome } from './src/types.ts';
import { groupBy, pct, secs } from './src/util.ts';

async function main() {
  if (!API_URL || !TABLE_NAME) {
    throw new Error('Set API_URL and TABLE_NAME');
  }
  const label = arg('--label') ?? 'run';
  const ticketsPath = arg('--tickets') ?? new URL('./tickets.jsonl', import.meta.url).pathname;

  const tickets = await loadTickets(ticketsPath);
  console.log(`Loaded ${tickets.length} tickets from ${ticketsPath}`);

  const startedAt = new Date();
  const submissions = await submitAll(tickets);
  const failed = submissions.filter((s) => !s.ticketId);
  console.log(`Submitted ${submissions.length - failed.length}/${submissions.length} (label: ${label})`);
  for (const f of failed) console.log(`  ${f.ticket.id}: ${f.status} ${f.error ?? ''}`);

  console.log('Collecting results...');
  const collected = await collectAll(submissions);
  const count = (o: Outcome) => collected.filter((c) => c.outcome === o).length;
  console.log(
    `processed ${count('processed')}, fallback ${count('fallback')}, ` +
      `timeout ${count('timeout')}, not submitted ${count('not-submitted')}`,
  );
  for (const c of collected) {
    const secs = c.processingMs === undefined ? '-' : `${(c.processingMs / 1000).toFixed(1)}s`;
    console.log(`  ${c.submission.ticket.id}  ${c.outcome.padEnd(13)} ${String(c.urgency ?? '-').padEnd(8)} ${secs}`);
  }

  console.log('Waiting for Bedrock metrics in CloudWatch...');
  const finishedAt = new Date();
  // Nothing reached the model, so no metrics will ever arrive: don't wait for them.
  const usage = submissions.some((s) => s.ticketId)
    ? await waitForUsage(MODEL_ID, startedAt, finishedAt)
    : { invocations: 0, inputTokens: 0, outputTokens: 0, throttles: 0 };

  // Compute everything once.
  const matrix = confusionMatrix(collected);
  const checks = checkReplies(collected);
  const git = gitInfo();
  const report: Report = {
    meta: {
      label,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      gitCommit: git.commit,
      gitDirty: git.dirty,
      ticketsFile: ticketsPath.split('/').pop()!,
      ticketsSha: await sha1(ticketsPath),
      modelId: MODEL_ID,
      pricePerMillion: { input: PRICE_PER_M_INPUT, output: PRICE_PER_M_OUTPUT },
      region: REGION,
      apiUrl: API_URL,
      concurrency: CONCURRENCY,
    },
    outcomes: {
      processed: count('processed'),
      fallback: count('fallback'),
      timeout: count('timeout'),
      'not-submitted': count('not-submitted'),
    },
    accuracy: scoreAccuracy(collected),
    matrix,
    levels: scoreLevels(matrix),
    byCategory: accuracyBy(groupBy(collected, (c) => c.submission.ticket.category)),
    redTeam: redTeamResults(collected, checks),
    replyChecks: checks,
    latency: {
      ack: latency(submissions.filter((s) => s.ticketId).map((s) => s.ackMs)),
      processing: latency(collected.flatMap((c) => (c.processingMs === undefined ? [] : [c.processingMs]))),
    },
    usage,
    costPerTicket: costPerTicket(usage, submissions.length),
    ticketCost: ticketCost(collected),
    ticketCostPerTicket: ticketCostPerTicket(ticketCost(collected)),
    tickets: ticketRows(collected, checks),
  };

  // Then display it.
  const a = report.accuracy;
  console.log(
    `Accuracy: model ${pct(a.model)} (${a.correct}/${a.processed}), system ${pct(a.system)} (${a.correct}/${a.total})`,
  );
  printMatrix(report.matrix);
  printLevels(report.levels);
  console.log('Reply checks (flags for the manual review):');
  printReplyChecks(report.replyChecks);
  console.log('Accuracy by category:');
  printAccuracyBy(report.byCategory);
  console.log('Red-team:');
  printRedTeam(report.redTeam);
  const { ack, processing } = report.latency;
  console.log(
    `Latency: submit→202 p50 ${secs(ack.p50)}, p95 ${secs(ack.p95)} | submit→draft p50 ${secs(processing.p50)}, p95 ${secs(processing.p95)}`,
  );
  console.log(
    `Cost: ${usage.invocations} invocations for ${submissions.length} tickets, ${usage.throttles} throttled; ` +
      `${usage.inputTokens} in / ${usage.outputTokens} out tokens; $${report.costPerTicket.toFixed(6)} per ticket`,
  );
  const t = report.ticketCost;
  if (t.withUsage > 0) {
    const perTicket =
      report.ticketCostPerTicket === undefined ? 'unknown' : `$${report.ticketCostPerTicket.toFixed(6)}`;
    console.log(
      `Cost from tickets: ${t.withUsage} with usage, ${t.priced} priced; ` +
        `${t.inputTokens} in / ${t.outputTokens} out tokens; ${perTicket} per ticket`,
    );
  }

  if (git.dirty) console.log("Note: uncommitted changes; the report's commit doesn't fully describe this run.");
  const files = await writeReport(report);
  console.log('Wrote:');
  for (const f of files) console.log(`  ${f}`);
}

// Value after a flag, e.g. arg("--label") for "--label v0". undefined if absent.
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
