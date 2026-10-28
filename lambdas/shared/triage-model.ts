// Everything that talks to the model: the prompt, the Bedrock call, and reading the answer.
// It knows nothing about SQS, DynamoDB or logging, so Step 2's switch to the Converse API
// changes only this file.
import { BedrockRuntimeClient, ConverseCommand, ToolConfiguration } from '@aws-sdk/client-bedrock-runtime';
import { PermanentError } from './classify-error';
import { TicketTriage, Urgency } from './types';

// Limits for one model call. Nova Lite answers a ticket in about 1–3 s, so 15 s per attempt
// is generous; without a limit a hanging call would use up the whole Lambda timeout.
export const MODEL_ATTEMPT_TIMEOUT_MS = 15_000;
export const MODEL_MAX_ATTEMPTS = 2;

const bedrockClient = new BedrockRuntimeClient({
    maxAttempts: MODEL_MAX_ATTEMPTS,
    requestHandler: { requestTimeout: MODEL_ATTEMPT_TIMEOUT_MS },
});

// Asks the model to triage one ticket. Bedrock errors are thrown as they are, and an
// answer we can't use is thrown as a PermanentError; the caller decides what to retry.
export async function invokeTriageModel(content: string, modelId: string): Promise<TicketTriage> {
    const inferenceConfig = {
        maxTokens: 512,
        temperature: 0.1,
        topP: 0.9,
    };

    const command = new ConverseCommand({
        modelId,
        inferenceConfig,
        toolConfig: buildToolConfig(),
        messages: [
            {
                role: 'user',
                content: [
                    {
                        text: buildPrompt(content),
                    },
                ],
            },
        ],
    });

    const response = await bedrockClient.send(command);

    const toolUse = response.output?.message?.content?.find((c) => c.toolUse)?.toolUse;
    if (toolUse?.input === undefined) {
        throw new PermanentError(`Model didn't call record_triage (stopReason: ${response.stopReason})`);
    }
    return parseModelAnswer(toolUse.input);
}

export function buildToolConfig(): ToolConfiguration {
    return {
        tools: [
            {
                toolSpec: {
                    name: 'record_triage',
                    inputSchema: {
                        json: {
                            type: 'object',
                            properties: {
                                urgency: { type: 'string', enum: Object.values(Urgency) },
                                response: { type: 'string' },
                            },
                            required: ['urgency', 'response'],
                        },
                    },
                },
            },
        ],
        toolChoice: { tool: { name: 'record_triage' } },
    };
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

// The input of the record_triage call. The schema asks for this shape but doesn't guarantee it,
// so nothing is trusted: a model answer we can't use is a permanent failure, never a default.
export function parseModelAnswer(input: unknown): TicketTriage {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new PermanentError('Model answer is not an object');
    }
    const { urgency, response } = input as Record<string, unknown>;
    if (!Object.values(Urgency).includes(urgency as Urgency)) {
        throw new PermanentError(`Model answer has an invalid urgency: ${String(urgency)}`);
    }
    if (typeof response !== 'string' || response.trim() === '') {
        throw new PermanentError('Model answer has no response');
    }
    return { urgency: urgency as Urgency, response };
}
