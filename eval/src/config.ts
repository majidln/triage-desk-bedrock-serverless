// Settings: environment, timeouts, the model and its prices.

// The stack output ends with "/", so strip it to avoid ".../Dev//support-request".
export const API_URL = process.env.API_URL?.replace(/\/+$/, '');
export const TABLE_NAME = process.env.TABLE_NAME;
// An Auth0 access token for the API (Step 3). Tickets are submitted as that user.
export const TOKEN = process.env.TOKEN;
export const REGION = process.env.AWS_REGION ?? 'us-east-1';
// Tickets in flight at once. Lower it with CONCURRENCY=1 on an account whose
// Lambda concurrency limit is low (new accounts start at 10).
export const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);
export const POLL_INTERVAL_MS = 5_000;
// How long to wait for drafts. Raise it for a model with a low requests-per-minute quota
// (Nova Pro 13, Claude Haiku 10 on this account): throttled tickets wait in SQS and retry,
// so 42 tickets take several minutes. e.g. COLLECT_TIMEOUT_MIN=15
export const COLLECT_TIMEOUT_MS = Number(process.env.COLLECT_TIMEOUT_MIN ?? 3) * 60_000;

// v0's canned replies (lambdas/handlers/support-request-processor.ts). A ticket
// with one of these was not answered by the model, whatever its status says.
export const FALLBACK_RESPONSES = [
  'Thank you for contacting support. We have received your request and will get back to you soon.',
  'Thank you for contacting support.',
];

// The model a run used is read from the tickets' usage.modelId (Step 2 on). This is only
// for a run where no ticket recorded one: v0's model, the template's default.
export const DEFAULT_MODEL_ID = 'amazon.nova-lite-v1:0';

export const MINUTE_MS = 60_000;
