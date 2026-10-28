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
    customerId: string;
    urgency?: Urgency;
    response?: string;
    analyticsGeneratedAt?: string;
    failure?: TicketFailure;
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

// What GET /support-request returns. `response` is set only once the ticket is PROCESSED.
export interface FetchTicketResponse {
    ticketId: string;
    status: TicketStatus;
    response?: string;
}
