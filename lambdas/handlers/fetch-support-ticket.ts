import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { FetchTicketResponse } from '../shared/types';

const ddClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddClient);

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const ticketId: string = event?.queryStringParameters?.ticketId || '';

        // Validate required fields
        if (!ticketId) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: 'ticketId is required',
                }),
            };
        }

        const command = new GetCommand({
            TableName: process.env.SUPPORT_TICKETS_TABLE,
            Key: {
                id: ticketId,
            },
        });
        const item = await docClient.send(command);

        console.log('Fetched ticket:', item.Item);

        // Use CreateTicketResponse type for response
        const response: FetchTicketResponse = {
            response: item.Item?.analytics?.response || undefined,
        };

        console.log('Response to return:', response);

        return {
            statusCode: 200,
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
