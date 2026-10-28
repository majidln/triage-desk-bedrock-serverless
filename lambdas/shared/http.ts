import { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

// An HTTP API response with a JSON body, labelled as JSON so clients don't have to guess.
export function json(statusCode: number, body: object): APIGatewayProxyStructuredResultV2 {
    return {
        statusCode,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    };
}
