import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { FetchTicketResponse, TicketStatus } from '../shared/types';
import { requireEnv } from '../shared/env';
import { json } from '../shared/http';
import { logger } from '../shared/logger';

// Read once at cold start: a missing variable fails here, not on the first request.
const config = {
    tableName: requireEnv('SUPPORT_TICKETS_TABLE'),
};

// Ticket ids are UUIDs (the receiver makes them). Checking the format first turns a
// junk id into a clear 400, instead of a DynamoDB error (a 500) for an oversized key.
const TICKET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ddClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddClient);

export const handler = async (
    event: APIGatewayProxyEventV2,
    context: Context,
): Promise<APIGatewayProxyStructuredResultV2> => {
    logger.addContext(context);

    const ticketId = event.queryStringParameters?.ticketId;
    if (!ticketId) {
        return json(400, { message: 'ticketId is required' });
    }
    if (!TICKET_ID.test(ticketId)) {
        return json(400, { message: 'ticketId must be a UUID' });
    }

    try {
        const { Item: item } = await docClient.send(
            new GetCommand({ TableName: config.tableName, Key: { id: ticketId } }),
        );
        if (!item) {
            return json(404, { message: 'ticket not found' });
        }

        // What the customer may see: the state, and the reply once there is one. Not the
        // urgency (that's for the support team) or why a ticket failed (internal detail).
        const status = item.status as TicketStatus;
        const response: FetchTicketResponse = { ticketId, status };
        if (status === TicketStatus.PROCESSED) {
            response.response = item.analytics?.response;
        }
        return json(200, response);
    } catch (err) {
        logger.error('RequestFailed', { ticketId, error: err });
        return json(500, { message: 'some error happened' });
    }
};
