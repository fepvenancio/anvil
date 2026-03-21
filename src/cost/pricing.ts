export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-6': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.30,
  },
  'claude-haiku-4-5-20250514': {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.10,
  },
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export function calculateCost(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
}): number {
  const pricing = MODEL_PRICING[usage.model] ?? MODEL_PRICING[DEFAULT_MODEL];
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTok +
    (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMTok +
    (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMTok
  );
}
