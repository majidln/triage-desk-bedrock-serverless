// Everything that talks to the model: the prompt, the Bedrock call, and reading the answer.
// It knows nothing about SQS, DynamoDB or logging, so Step 2's switch to the Converse API
// changes only this file.
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { PermanentError } from './classify-error';
import { TicketTriage, Urgency } from './types';

const bedrockClient = new BedrockRuntimeClient({});

// Asks the model to triage one ticket. Bedrock errors are thrown as they are, and an
// answer we can't use is thrown as a PermanentError; the caller decides what to retry.
export async function invokeTriageModel(content: string, modelId: string): Promise<TicketTriage> {
    const response = await bedrockClient.send(
        new InvokeModelCommand({
            modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
                messages: [{ role: 'user', content: [{ text: buildPrompt(content) }] }],
                inferenceConfig: {
                    max_new_tokens: 512,
                    temperature: 0.1,
                    top_p: 0.9,
                },
            }),
        }),
    );
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Nova returns content in this structure
    const resultText = responseBody.output.message.content[0].text.trim();
    return parseModelAnswer(resultText);
}

export function buildPrompt(content: string): string {
    return `Analyze the following customer support ticket and provide:
1. Urgency level (${Object.values(Urgency).join(', ')})
2. A professional response

Ticket: ${content}

Respond in JSON format:
{
    "urgency": "The ticket urgency level",
    "response": "Your response to the ticket"
}`;
}

// A model answer we can't use is a permanent failure, never a default urgency or reply.
export function parseModelAnswer(resultText: string): TicketTriage {
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    let result: { urgency?: unknown; response?: unknown };
    try {
        result = JSON.parse(jsonMatch?.[0] ?? '');
    } catch {
        throw new PermanentError('Model answer is not JSON');
    }
    if (!Object.values(Urgency).includes(result.urgency as Urgency)) {
        throw new PermanentError(`Model answer has an invalid urgency: ${String(result.urgency)}`);
    }
    if (typeof result.response !== 'string' || result.response.trim() === '') {
        throw new PermanentError('Model answer has no response');
    }
    return { urgency: result.urgency as Urgency, response: result.response };
}
