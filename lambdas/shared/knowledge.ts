import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { RetrievedChunk } from './types';

export const RETRIEVE_ATTEMPT_TIMEOUT_MS = 5_000;
export const RETRIEVE_MAX_ATTEMPTS = 2;

// How many chunks the model gets. More covers more questions, but buries the answer among
export const DEFAULT_NUMBER_OF_RESULTS = 3;

const agentClient = new BedrockAgentRuntimeClient({
  maxAttempts: RETRIEVE_MAX_ATTEMPTS,
  requestHandler: { requestTimeout: RETRIEVE_ATTEMPT_TIMEOUT_MS },
});

// Finds the chunks closest in meaning to the query, best first. Errors are thrown as they
// are; the caller decides what to retry. Finding nothing is an empty list, not an error:
// the prompt tells the model what to do when the documents don't cover a ticket.
export async function retrieveChunks(
  query: string,
  knowledgeBaseId: string,
  numberOfResults = DEFAULT_NUMBER_OF_RESULTS,
): Promise<RetrievedChunk[]> {
  const response = await agentClient.send(
    new RetrieveCommand({
      knowledgeBaseId,
      retrievalQuery: { text: query },
      retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults } },
    }),
  );

  // A result without text is useless to the model, so it's dropped before numbering:
  // the ids the model sees run 1, 2, 3 with no gaps.
  const found = (response.retrievalResults ?? []).flatMap((result) => {
    const text = result.content?.text;
    return text ? [{ source: fileName(result.location?.s3Location?.uri), text, score: result.score ?? 0 }] : [];
  });
  return found.map((chunk, index) => ({ id: String(index + 1), ...chunk }));
}

// s3://bucket/help-center/billing-guide.txt → billing-guide.txt
function fileName(uri: string | undefined): string {
  return uri?.split('/').pop() || 'unknown';
}
