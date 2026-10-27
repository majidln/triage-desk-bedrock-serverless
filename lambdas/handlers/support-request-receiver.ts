import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { PutCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import { TicketStatus, CreateTicketRequest, CreateTicketResponse } from '../shared/types';

const ddClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddClient);
const sqsClient = new SQSClient({});

const queueUrl = process.env.SUPPORT_REQUEST_QUEUE || '';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        // Parse and validate request body using CreateTicketRequest type
        const requestBody: CreateTicketRequest = event.body ? JSON.parse(event.body) : {};

        // Validate required fields
        if (!requestBody.content) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: 'content is required',
                }),
            };
        }

        const ticketId = uuidv4();
        const customerId = requestBody.customerId || 'customer-id-from-api-gateway'; // TODO: get customer id from api gateway

        const command = new PutCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            Item: {
                id: ticketId,
                content: requestBody.content,
                status: TicketStatus.RECEIVED,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                customerId: customerId,
            },
        });
        await docClient.send(command);

        const sendMessageCommand = new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify({
                ticketId: ticketId,
                content: requestBody.content,
            }),
        });
        await sqsClient.send(sendMessageCommand);

        // Use CreateTicketResponse type for response
        const response: CreateTicketResponse = {
            message: 'new ticket has been created for this request',
            ticketId: ticketId,
        };

        return {
            statusCode: 202,
            body: JSON.stringify(response),
        };
    } catch (err) {
        console.log(err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'some error happened',
            }),
        };
    }
};
