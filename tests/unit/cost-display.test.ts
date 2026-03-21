import { describe, it, expect } from 'vitest';
import { formatCostSummary } from '../../src/cost/display.js';
import type { CostReport } from '../../src/schemas/reports.js';

describe('formatCostSummary', () => {
  it('Test 1: returns a multi-line string with session total', () => {
    const report: CostReport = {
      sessionId: 'test-session',
      entries: [
        { agent: 'planner', inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.052 },
        { agent: 'worker:task-001', inputTokens: 2100, outputTokens: 5600, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.091 },
        { agent: 'high-court', inputTokens: 800, outputTokens: 1200, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.021 },
      ],
      totalCostUsd: 0.164,
      timestamp: new Date().toISOString(),
    };

    const output = formatCostSummary(report);
    expect(output).toContain('Cost Summary');
    expect(output).toContain('Total');
    expect(output).toContain('$0.1640');
    expect(output.split('\n').length).toBeGreaterThan(3);
  });

  it('Test 2: shows per-agent breakdown with agent name and costUsd', () => {
    const report: CostReport = {
      sessionId: 'test-session',
      entries: [
        { agent: 'planner', inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.052 },
        { agent: 'worker:task-001', inputTokens: 2100, outputTokens: 5600, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.091 },
        { agent: 'high-court', inputTokens: 800, outputTokens: 1200, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.021 },
      ],
      totalCostUsd: 0.164,
      timestamp: new Date().toISOString(),
    };

    const output = formatCostSummary(report);
    expect(output).toContain('planner');
    expect(output).toContain('worker:task-001');
    expect(output).toContain('high-court');
    expect(output).toContain('$0.0520');
    expect(output).toContain('$0.0910');
    expect(output).toContain('$0.0210');
  });

  it('Test 3: handles empty entries array gracefully', () => {
    const report: CostReport = {
      sessionId: 'test-session',
      entries: [],
      totalCostUsd: 0,
      timestamp: new Date().toISOString(),
    };

    const output = formatCostSummary(report);
    expect(output).toContain('No API calls recorded.');
  });

  it('Test 4: formats token counts with K suffix for thousands', () => {
    const report: CostReport = {
      sessionId: 'test-session',
      entries: [
        { agent: 'planner', inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.052 },
        { agent: 'worker', inputTokens: 500, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01 },
      ],
      totalCostUsd: 0.062,
      timestamp: new Date().toISOString(),
    };

    const output = formatCostSummary(report);
    // 1200 -> "1.2K", 500 stays "500"
    expect(output).toContain('1.2K');
    expect(output).toContain('3.4K');
    expect(output).toMatch(/\b500\b/);
  });
});
