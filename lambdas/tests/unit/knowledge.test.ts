import { beforeEach, describe, expect, it } from '@jest/globals';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import { retrieveChunks } from '../../shared/knowledge';

const agentMock = mockClient(BedrockAgentRuntimeClient);

// One Retrieve result, shaped like the real response
function result(file: string, text: string, score: number) {
  return {
    content: { text },
    location: { type: 'S3' as const, s3Location: { uri: `s3://docs-bucket/help-center/${file}` } },
    score,
  };
}

describe('retrieveChunks', () => {
  beforeEach(() => {
    agentMock.reset();
  });

  it('asks the given Knowledge Base for the given number of results', async () => {
    agentMock.on(RetrieveCommand).resolves({ retrievalResults: [] });

    await retrieveChunks('Can we get a refund?', 'KB123', 5);

    const input = agentMock.commandCalls(RetrieveCommand)[0].args[0].input;
    expect(input).toEqual({
      knowledgeBaseId: 'KB123',
      retrievalQuery: { text: 'Can we get a refund?' },
      retrievalConfiguration: { vectorSearchConfiguration: { numberOfResults: 5 } },
    });
  });

  it('asks for 3 results by default', async () => {
    agentMock.on(RetrieveCommand).resolves({ retrievalResults: [] });

    await retrieveChunks('Can we get a refund?', 'KB123');

    const input = agentMock.commandCalls(RetrieveCommand)[0].args[0].input;
    expect(input.retrievalConfiguration?.vectorSearchConfiguration?.numberOfResults).toBe(3);
  });

  it('numbers the chunks from 1, best first, with the file name as the source', async () => {
    agentMock.on(RetrieveCommand).resolves({
      retrievalResults: [
        result('billing-guide.txt', 'Monthly plans are not refunded.', 0.69),
        result('getting-help.txt', 'Contact support by email.', 0.55),
      ],
    });

    await expect(retrieveChunks('Can we get a refund?', 'KB123')).resolves.toEqual([
      { id: '1', source: 'billing-guide.txt', text: 'Monthly plans are not refunded.', score: 0.69 },
      { id: '2', source: 'getting-help.txt', text: 'Contact support by email.', score: 0.55 },
    ]);
  });

  it('drops a result without text, and leaves no gap in the ids', async () => {
    agentMock.on(RetrieveCommand).resolves({
      retrievalResults: [
        result('billing-guide.txt', 'Monthly plans are not refunded.', 0.69),
        result('using-flowboard.txt', '', 0.6),
        result('getting-help.txt', 'Contact support by email.', 0.55),
      ],
    });

    const chunks = await retrieveChunks('Can we get a refund?', 'KB123');

    expect(chunks.map((c) => [c.id, c.source])).toEqual([
      ['1', 'billing-guide.txt'],
      ['2', 'getting-help.txt'],
    ]);
  });

  it('returns an empty list when nothing is found', async () => {
    agentMock.on(RetrieveCommand).resolves({});

    await expect(retrieveChunks('Can we get a refund?', 'KB123')).resolves.toEqual([]);
  });

  it('lets a Retrieve error through for the caller to classify', async () => {
    agentMock.on(RetrieveCommand).rejects(Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' }));

    await expect(retrieveChunks('Can we get a refund?', 'KB123')).rejects.toMatchObject({
      name: 'ThrottlingException',
    });
  });
});
