import { describe, it, expect } from 'vitest';
import { CostTracker } from '../../src/cost/tracker.js';
import { calculateCost, MODEL_PRICING } from '../../src/cost/pricing.js';
import { CostEntrySchema } from '../../src/schemas/reports.js';

describe('CostTracker', () => {
  it('Test 1: record() stores a TokenUsage entry and entries array grows', () => {
    const tracker = new CostTracker();
    tracker.record({
      agent: 'planner',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-6',
    });
    const report = tracker.toCostReport('test-session');
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].agent).toBe('planner');
  });

  it('Test 2: recordFromResponse() extracts usage from Anthropic-style response', () => {
    const tracker = new CostTracker();
    const fakeResponse = {
      usage: {
        input_tokens: 2000,
        output_tokens: 1000,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 300,
      },
    };
    tracker.recordFromResponse(fakeResponse, 'worker', 'claude-sonnet-4-6', 1);
    const report = tracker.toCostReport('test-session');
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0].inputTokens).toBe(2000);
    expect(report.entries[0].outputTokens).toBe(1000);
    expect(report.entries[0].cacheWriteTokens).toBe(500);
    expect(report.entries[0].cacheReadTokens).toBe(300);
  });

  it('Test 5: toCostReport(sessionId) produces a valid CostReport with correct totalCostUsd', () => {
    const tracker = new CostTracker();
    tracker.record({
      agent: 'planner',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-6',
    });
    const report = tracker.toCostReport('session-1');
    expect(report.sessionId).toBe('session-1');
    expect(report.totalCostUsd).toBeCloseTo(18, 5); // 3 + 15
    expect(report.entries).toHaveLength(1);
    expect(report.timestamp).toBeDefined();
  });

  it('Test 6: getWaveCost(waveNumber) returns sum for matching wave entries', () => {
    const tracker = new CostTracker();
    tracker.record({
      agent: 'worker-1',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-6',
      waveNumber: 1,
    });
    tracker.record({
      agent: 'worker-2',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-6',
      waveNumber: 2,
    });
    tracker.record({
      agent: 'worker-3',
      inputTokens: 2000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-6',
      waveNumber: 1,
    });

    const wave1Cost = tracker.getWaveCost(1);
    // wave1: (1000/1e6)*3 + (500/1e6)*15 + (2000/1e6)*3 + (1000/1e6)*15 = 0.003+0.0075+0.006+0.015 = 0.0315
    expect(wave1Cost).toBeCloseTo(0.0315, 6);

    const wave2Cost = tracker.getWaveCost(2);
    // wave2: (1000/1e6)*3 + (500/1e6)*15 = 0.003+0.0075 = 0.0105
    expect(wave2Cost).toBeCloseTo(0.0105, 6);
  });

  it('Test 7: getSessionCost() returns total across all entries', () => {
    const tracker = new CostTracker();
    tracker.record({
      agent: 'planner',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-6',
    });
    tracker.record({
      agent: 'worker',
      inputTokens: 2000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-6',
    });

    const sessionCost = tracker.getSessionCost();
    // (1000/1e6)*3 + (500/1e6)*15 + (2000/1e6)*3 + (1000/1e6)*15 = 0.003+0.0075+0.006+0.015 = 0.0315
    expect(sessionCost).toBeCloseTo(0.0315, 6);
  });
});

describe('calculateCost', () => {
  it('Test 3: returns correct USD for claude-sonnet-4-6 pricing', () => {
    const cost = calculateCost({
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-6',
    });
    // (1000/1e6)*3 + (1000/1e6)*15 = 0.003 + 0.015 = 0.018
    expect(cost).toBeCloseTo(0.018, 6);
  });

  it('Test 4: falls back to sonnet pricing for unknown model strings', () => {
    const cost = calculateCost({
      inputTokens: 1000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'unknown-model-2025',
    });
    // Same as sonnet: 0.018
    expect(cost).toBeCloseTo(0.018, 6);
  });
});

describe('CostEntrySchema', () => {
  it('Test 8: validates objects with optional waveNumber field', () => {
    const result = CostEntrySchema.safeParse({
      agent: 'planner',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.001,
      waveNumber: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.waveNumber).toBe(1);
    }
  });

  it('Test 9: validates objects without waveNumber (backward compat)', () => {
    const result = CostEntrySchema.safeParse({
      agent: 'planner',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.001,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.waveNumber).toBeUndefined();
    }
  });
});
