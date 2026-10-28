import { TicketStatus, TicketView } from './types';

// What the customer-facing routes read of a stored ticket. Never the content: it isn't
// returned, so it isn't read.
export interface StoredTicket {
  id: string;
  userId?: string;
  status: TicketStatus;
  createdAt: string;
  analytics?: { response?: string };
}

// The DynamoDB projection for StoredTicket. `status` is a reserved word, hence the name.
export const STORED_TICKET_PROJECTION = {
  ProjectionExpression: 'id, userId, #status, createdAt, analytics',
  ExpressionAttributeNames: { '#status': 'status' },
};

// What the customer may see: the state, and the reply once there is one. Not the
// urgency (that's for the support team) or why a ticket failed (internal detail).
export function toTicketView(ticket: StoredTicket): TicketView {
  const view: TicketView = { ticketId: ticket.id, status: ticket.status, createdAt: ticket.createdAt };
  if (ticket.status === TicketStatus.PROCESSED) {
    view.response = ticket.analytics?.response;
  }
  return view;
}
