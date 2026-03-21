import { calculateCost } from './pricing.js';
import type { CostReport } from '../schemas/reports.js';

export interface TokenUsage {
  agent: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  waveNumber?: number;
}

export class CostTracker {
  private entries: TokenUsage[] = [];

  record(usage: TokenUsage): void {
    this.entries.push(usage);
  }

  recordFromResponse(
    response: {
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    },
    agent: string,
    model: string,
    waveNumber?: number,
  ): void {
    this.record({
      agent,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      model,
      waveNumber,
    });
  }

  toCostReport(sessionId: string): CostReport {
    const entries = this.entries.map((entry) => ({
      agent: entry.agent,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheWriteTokens: entry.cacheWriteTokens,
      waveNumber: entry.waveNumber,
      costUsd: calculateCost(entry),
    }));

    const totalCostUsd = entries.reduce((sum, e) => sum + e.costUsd, 0);

    return {
      sessionId,
      entries,
      totalCostUsd,
      timestamp: new Date().toISOString(),
    };
  }

  getWaveCost(waveNumber: number): number {
    return this.entries
      .filter((e) => e.waveNumber === waveNumber)
      .reduce((sum, e) => sum + calculateCost(e), 0);
  }

  getSessionCost(): number {
    return this.entries.reduce((sum, e) => sum + calculateCost(e), 0);
  }
}
