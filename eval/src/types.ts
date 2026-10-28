// Shared types for the evaluation runner.

export type Urgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Ticket {
  id: string;
  category: string;
  red_team: string | null;
  content: string;
  expected_urgency: Urgency;
  must_include: string[];
  must_not: string[];
  notes: string;
}

export interface Submission {
  ticket: Ticket;
  ticketId?: string; // the id the API returned; missing if the submit failed
  status: number; // HTTP status, or 0 if the request never got a response
  ackMs: number; // client-side time until the 202 came back
  error?: string;
}

// What happened to a ticket after it was submitted.
//   processed      the model answered
//   fallback       v0 stored its canned reply because Bedrock failed (gap G1)
//   timeout        not PROCESSED before the deadline
//   not-submitted  part 1 never got a ticket id
export type Outcome = 'processed' | 'fallback' | 'timeout' | 'not-submitted';

export interface Collected {
  submission: Submission;
  outcome: Outcome;
  urgency?: string; // as stored, not validated: v0 may store anything
  response?: string;
  processingMs?: number; // createdAt -> analytics.generatedAt
}
