// What each model costs, so every ticket can record what it cost. A constant, not a lookup:
// prices change rarely, and asking AWS on every ticket would add a network call and a way to fail.

// USD per million tokens.
export interface ModelPrice {
  inputPerM: number;
  outputPerM: number;
}

// On-demand text prices in us-east-1, from the AWS Price List API (service AmazonBedrock),
// checked on 2026-10-28. Add a model here before deploying with it; a model missing from this
// table still works, its tickets just have no cost.
export const MODEL_PRICES: Record<string, ModelPrice> = {
  'amazon.nova-lite-v1:0': { inputPerM: 0.06, outputPerM: 0.24 },
  'amazon.nova-pro-v1:0': { inputPerM: 0.8, outputPerM: 3.2 },
};

// The price of one call, or undefined when the model isn't in the table.
export function priceFor(modelId: string): ModelPrice | undefined {
  return MODEL_PRICES[modelId];
}

// What one call cost, with the prices used. Empty when the price or a token count is unknown:
// an unknown cost is left out, never recorded as 0. The tokens are kept either way, so the
// cost can be worked out later.
export function callCost(
  modelId: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): { inputPricePerM?: number; outputPricePerM?: number; costUsd?: number } {
  const price = priceFor(modelId);
  if (price === undefined || inputTokens === undefined || outputTokens === undefined) {
    return {};
  }
  const costUsd = (inputTokens * price.inputPerM + outputTokens * price.outputPerM) / 1_000_000;
  return {
    inputPricePerM: price.inputPerM,
    outputPricePerM: price.outputPerM,
    // Rounded to 10 decimals, a millionth of a cent, to keep floating-point noise out of the data.
    costUsd: Number(costUsd.toFixed(10)),
  };
}
