export enum TicketStatus {
  RECEIVED = 'RECEIVED',
  PROCESSED = 'PROCESSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface SupportTicketMessage {
  ticketId: string;
  content: string;
  flags: string[]; // What the guardrail found (see shared/guardrail.ts). Flagged tickets skip the model.
}

export enum Urgency {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// The model's triage of a ticket. Stored in DynamoDB under the `triage` attribute, with the
// time it was made (StoredTriage).
export interface TicketTriage {
  urgency: Urgency;
  response: string;
  sources: string[]; // The documents the reply relies on, by file name: only ones that were retrieved
}

export interface StoredTriage extends TicketTriage {
  generatedAt: string;
}

// What the guardrail found when the ticket arrived. Stored under the `guardrail` attribute.
// `version` is the guardrail version that judged it, so a ticket shows which rules applied.
export interface GuardrailResult {
  flags: string[];
  piiTypes: string[]; // The kinds of PII masked, never the values
  version: string;
  checkedAt: string;
}

// What one model call used. Stored in DynamoDB under the `usage` attribute. The counts are
// optional because Bedrock may not report them; a missing count never fails a ticket. The cost
// and the prices it used are set only when the model has a price (see model-prices.ts).
export interface LlmUsage {
  modelId: string;
  inputTokens?: number;
  outputTokens?: number;
  inputPricePerM?: number;
  outputPricePerM?: number;
  costUsd?: number;
}

// What a model call returns: the answer, and what it cost.
export interface TriageResult {
  triage: TicketTriage;
  usage: LlmUsage;
}

export interface TicketFailure {
  errorName: string;
  message: string;
  failedAt: string;
}

// A stored ticket. Top-level: what identifies it and what we query on. Each nested map has one
// writer and is written once: `guardrail` by the receiver, `triage` and `usage` (or `failure`)
// by the processor.
export interface SupportTicket {
  id: string;
  userId: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  content: string; // Masked by the guardrail
  guardrail?: GuardrailResult;
  triage?: StoredTriage;
  usage?: LlmUsage;
  failure?: TicketFailure;
  notifiedAt?: string;
}

export interface CreateTicketRequest {
  content: string;
}

export interface CreateTicketResponse {
  message: string;
  ticketId: string;
}

// A ticket as its customer sees it: GET /support-request returns one, GET /support-requests a
// page of them. `response` is set only once the ticket is PROCESSED.
export interface TicketView {
  ticketId: string;
  status: TicketStatus;
  createdAt: string;
  response?: string;
}

// What GET /support-requests returns: the caller's tickets, newest first. Pass `nextToken`
// back to get the next page; there is none on the last page.
export interface ListTicketsResponse {
  tickets: TicketView[];
  nextToken?: string;
}

// One chunk of Flowboard's documents that Retrieve found for a ticket (see shared/knowledge.ts).
export interface RetrievedChunk {
  id: string;
  source: string;
  text: string;
  score: number;
}
