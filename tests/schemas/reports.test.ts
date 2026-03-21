import { describe, it, expect } from 'vitest';
import {
  SubJudgeReportSchema,
  HighCourtReportSchema,
  CostReportSchema,
} from '../../src/schemas/reports.js';

describe('SubJudgeReportSchema', () => {
  it('accepts valid report', () => {
    const result = SubJudgeReportSchema.safeParse({
      waveNumber: 1,
      checks: [{ name: 'tsc', passed: true }],
      allPassed: true,
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('HighCourtReportSchema', () => {
  it('accepts report with verdict merge', () => {
    const result = HighCourtReportSchema.safeParse({
      verdict: 'merge',
      reasoning: 'All checks passed',
      concerns: [],
      invariantChecks: [{ name: 'no-circular-deps', passed: true }],
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts verdict human_required', () => {
    const result = HighCourtReportSchema.safeParse({
      verdict: 'human_required',
      reasoning: 'Needs review',
      concerns: ['Architecture concern'],
      invariantChecks: [],
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid verdict', () => {
    const result = HighCourtReportSchema.safeParse({
      verdict: 'invalid',
      reasoning: 'x',
      concerns: [],
      invariantChecks: [],
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('CostReportSchema', () => {
  it('accepts valid cost report', () => {
    const result = CostReportSchema.safeParse({
      sessionId: 'sess-1',
      entries: [{
        agent: 'planner',
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.015,
      }],
      totalCostUsd: 0.015,
      timestamp: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});
