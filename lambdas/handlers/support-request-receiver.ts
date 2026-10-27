import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { TicketStatus, CreateTicketRequest, CreateTicketResponse } from '../shared/types';
import { requireEnv } from '../shared/env';
import { json } from '../shared/http';
import { logger } from '../shared/logger';

// Read once at cold start: a missing variable fails here, not on the first request.
const config = {
    tableName: requireEnv('SUPPORT_TICKETS_TABLE'),
    queueUrl: requireEnv('SUPPORT_REQUEST_QUEUE'),
};

const ddClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddClient);
const sqsClient = new SQSClient({});

export const handler = async (
    event: APIGatewayProxyEventV2,
    context: Context,
): Promise<APIGatewayProxyStructuredResultV2> => {
    logger.addContext(context);

    // A bad request is the client's mistake: 400 with the reason, never a 500
    const parsed = parseRequest(event.body);
    if (typeof parsed === 'string') {
        return json(400, { message: parsed });
    }

    try {
        const ticketId = uuidv4();
        const customerId = parsed.customerId || 'customer-id-from-api-gateway'; // TODO: get customer id from api gateway
        const now = new Date().toISOString();

        await docClient.send(
            new PutCommand({
                TableName: config.tableName,
                Item: {
                    id: ticketId,
                    content: parsed.content,
                    status: TicketStatus.RECEIVED,
                    createdAt: now,
                    updatedAt: now,
                    customerId,
                },
            }),
        );

        await sqsClient.send(
            new SendMessageCommand({
                QueueUrl: config.queueUrl,
                MessageBody: JSON.stringify({ ticketId, content: parsed.content }),
            }),
        );

        logger.info('TicketReceived', { ticketId, contentLength: parsed.content.length });
        const response: CreateTicketResponse = {
            message: 'new ticket has been created for this request',
            ticketId,
        };
        return json(202, response);
    } catch (err) {
        logger.error('RequestFailed', { error: err });
        return json(500, { message: 'some error happened' });
    }
};

// The request body as a ticket request, or the reason it isn't one.
function parseRequest(body: string | undefined): CreateTicketRequest | string {
    let request: unknown;
    try {
        request = JSON.parse(body ?? '');
    } catch {
        return 'body must be JSON';
    }
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
        return 'body must be a JSON object';
    }
    const { content, customerId } = request as Record<string, unknown>;
    if (typeof content !== 'string' || content.trim() === '') {
        return 'content is required';
    }
    return { content, customerId: typeof customerId === 'string' ? customerId : undefined };
}
