export enum TicketStatus {
  RECEIVED = 'RECEIVED',
  PROCESSED = 'PROCESSED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface SupportTicketMessage {
  ticketId: string;
  content: string;
}

export enum Urgency {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// The model's triage of a ticket. Stored in DynamoDB under the `analytics` attribute.
export interface TicketTriage {
  urgency: Urgency;
  response: string;
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

export interface SupportTicket {
  id: string;
  content: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  userId: string;
  urgency?: Urgency;
  response?: string;
  analyticsGeneratedAt?: string;
  failure?: TicketFailure;
  usage?: LlmUsage;
  notifiedAt?: string;
}

export interface CreateTicketRequest {
  content: string;
  customerId?: string;
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
