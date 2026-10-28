import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { callCost, MODEL_PRICES, priceFor } from '../../shared/model-prices';

describe('callCost', () => {
  it('works out the cost from the tokens and the price, and keeps the price it used', () => {
    expect(callCost('amazon.nova-lite-v1:0', 527, 138)).toEqual({
      inputPricePerM: 0.06,
      outputPricePerM: 0.24,
      costUsd: 0.00006474, // (527 × 0.06 + 138 × 0.24) / 1M
    });
  });

  it('uses each model its own price', () => {
    expect(callCost('amazon.nova-pro-v1:0', 1_000_000, 1_000_000).costUsd).toBe(4);
  });

  it.each([
    ['a model without a price', 'amazon.nova-micro-v1:0', 527, 138],
    ['no input count', 'amazon.nova-lite-v1:0', undefined, 138],
    ['no output count', 'amazon.nova-lite-v1:0', 527, undefined],
  ])('leaves the cost out, never 0, for %s', (_label, modelId, inputTokens, outputTokens) => {
    expect(callCost(modelId, inputTokens, outputTokens)).toEqual({});
  });
});

describe('MODEL_PRICES', () => {
  // Any model can be deployed, but the one a plain `sam deploy` uses should always have a cost.
  it("has a price for the template's default model", () => {
    const template = readFileSync(join(__dirname, '../../../template.yaml'), 'utf8');
    const defaultModel = template.match(/^ {2}ModelId:\n(?: {4}.*\n)*? {4}Default: (\S+)/m)?.[1];

    expect(defaultModel).toBe('amazon.nova-lite-v1:0');
    expect(priceFor(defaultModel!)).toBeDefined();
  });

  it('gives prices per million tokens, not per thousand', () => {
    for (const price of Object.values(MODEL_PRICES)) {
      expect(price.inputPerM).toBeGreaterThan(0.001);
    }
  });
});
