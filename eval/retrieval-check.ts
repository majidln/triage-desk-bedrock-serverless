// Retrieval check: does the Knowledge Base return the facts a ticket needs?
//
// Usage:
//   KNOWLEDGE_BASE_ID=<id> npx tsx retrieval-check.ts --label fixed-300 [--top 3]
//
// For every case in retrieval-cases.json (the tickets that need a document fact, and the
// COVERAGE.md questions no ticket asks), it calls Retrieve once and checks whether the
// expected phrases appear in the top chunks. No model is called, so a run takes seconds
// and costs almost nothing: it measures what chunking changes, not what the model makes of it.

import { readFile, writeFile } from 'node:fs/promises';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { REGION } from './src/config.ts';
import { loadTickets } from './src/tickets.ts';
import { pct, ratio } from './src/util.ts';

interface Case {
  group: 'ticket' | 'coverage';
  name: string;
  query: string;
  expect: string[];
}

interface CaseResult extends Case {
  found: string[];
  missing: string[];
  chunks: number;
  words: number;
  sources: string[];
}

const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID;
const args = process.argv.slice(2);
const label = valueOf('--label');
const top = Number(valueOf('--top') ?? 3);

function valueOf(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// The guides are Markdown uploaded as text: bold markers and spacing differ between a phrase
// and the chunk it's in, so both are compared without them.
function normalize(text: string): string {
  return text.replace(/\*/g, '').replace(/\s+/g, ' ').toLowerCase();
}

async function loadCases(): Promise<Case[]> {
  const file = JSON.parse(await readFile('retrieval-cases.json', 'utf8')) as {
    tickets: Record<string, string[]>;
    coverage: { query: string; expect: string[] }[];
  };
  const tickets = new Map((await loadTickets('tickets.jsonl')).map((t) => [t.id, t.content]));
  const ticketCases = Object.entries(file.tickets).map(([id, expect]): Case => {
    const query = tickets.get(id);
    if (query === undefined) throw new Error(`retrieval-cases.json names ${id}, which isn't in tickets.jsonl`);
    return { group: 'ticket', name: id, query, expect };
  });
  const coverageCases = file.coverage.map((c): Case => ({ group: 'coverage', name: c.query, ...c }));
  return [...ticketCases, ...coverageCases];
}

async function check(client: BedrockAgentRuntimeClient, c: Case): Promise<CaseResult> {
  const response = await client.send(
    new RetrieveCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      retrievalQuery: { text: c.query },
      retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: top } },
    }),
  );
  const results = response.retrievalResults ?? [];
  const text = normalize(results.map((r) => r.content?.text ?? '').join(' '));
  const found = c.expect.filter((phrase) => text.includes(normalize(phrase)));
  return {
    ...c,
    found,
    missing: c.expect.filter((phrase) => !found.includes(phrase)),
    chunks: results.length,
    words: results.reduce((sum, r) => sum + (r.content?.text ?? '').split(/\s+/).length, 0),
    sources: results.map((r) => r.location?.s3Location?.uri?.split('/').pop() ?? 'unknown'),
  };
}

function summary(results: CaseResult[]) {
  const phrases = results.reduce((sum, r) => sum + r.expect.length, 0);
  const found = results.reduce((sum, r) => sum + r.found.length, 0);
  return {
    cases: results.length,
    complete: results.filter((r) => r.missing.length === 0).length,
    phrases,
    found,
    avgChunks: ratio(
      results.reduce((sum, r) => sum + r.chunks, 0),
      results.length,
    ),
    avgWords: ratio(
      results.reduce((sum, r) => sum + r.words, 0),
      results.length,
    ),
  };
}

async function main() {
  if (!KNOWLEDGE_BASE_ID || !label) {
    throw new Error('Usage: KNOWLEDGE_BASE_ID=<id> npx tsx retrieval-check.ts --label <name> [--top 3]');
  }
  const client = new BedrockAgentRuntimeClient({ region: REGION });
  const cases = await loadCases();

  // One at a time: a few dozen calls finish in seconds, and Retrieve has a low request quota
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await check(client, c));

  const groups = {
    tickets: summary(results.filter((r) => r.group === 'ticket')),
    coverage: summary(results.filter((r) => r.group === 'coverage')),
    all: summary(results),
  };
  for (const [name, s] of Object.entries(groups)) {
    console.log(
      `${name.padEnd(9)} complete ${s.complete}/${s.cases} (${pct(ratio(s.complete, s.cases))})` +
        ` | phrases ${s.found}/${s.phrases} (${pct(ratio(s.found, s.phrases))})` +
        ` | ${s.avgChunks.toFixed(1)} chunks, ${Math.round(s.avgWords)} words per query`,
    );
  }
  console.log('\nMissed:');
  for (const r of results.filter((r) => r.missing.length > 0)) {
    console.log(`  ${r.name.slice(0, 50).padEnd(50)} missing: ${r.missing.join(' | ')}  (got ${r.sources.join(', ')})`);
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*/, '')
    .replace(/^(\d{8})/, (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`);
  const path = `reports/${stamp}-retrieval-${label}.json`;
  await writeFile(path, JSON.stringify({ label, knowledgeBaseId: KNOWLEDGE_BASE_ID, top, groups, results }, null, 2));
  console.log(`\nWrote ${path}`);
}

await main();
