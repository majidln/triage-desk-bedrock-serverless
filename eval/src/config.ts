// Settings: environment, timeouts, the model and its prices.

// The stack output ends with "/", so strip it to avoid ".../Dev//support-request".
export const API_URL = process.env.API_URL?.replace(/\/+$/, '');
export const TABLE_NAME = process.env.TABLE_NAME;
export const REGION = process.env.AWS_REGION ?? 'us-east-1';
// Tickets in flight at once. Lower it with CONCURRENCY=1 on an account whose
// Lambda concurrency limit is low (new accounts start at 10).
export const CONCURRENCY = Number(process.env.CONCURRENCY ?? 3);
export const POLL_INTERVAL_MS = 5_000;
export const COLLECT_TIMEOUT_MS = 180_000;

// v0's canned replies (lambdas/handlers/support-request-processor.ts). A ticket
// with one of these was not answered by the model, whatever its status says.
export const FALLBACK_RESPONSES = [
  'Thank you for contacting support. We have received your request and will get back to you soon.',
  'Thank you for contacting support.',
];

// The model v0 calls (BEDROCK_MODEL_ID in template.yaml) and its approximate
// us-east-1 on-demand prices. Check the Bedrock pricing page before relying on them.
export const MODEL_ID = 'amazon.nova-lite-v1:0';
export const PRICE_PER_M_INPUT = 0.06;
export const PRICE_PER_M_OUTPUT = 0.24;

export const MINUTE_MS = 60_000;
