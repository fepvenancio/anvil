import { describe, it, expect } from 'vitest';
import { PlanSchema, TaskSchema } from '../../src/schemas/plan.js';
import { AnvilConfigSchema } from '../../src/schemas/config.js';
import { WaveSchema, WaveStateSchema } from '../../src/schemas/wave.js';
import { SessionStateSchema } from '../../src/schemas/session.js';
import {
  SubJudgeReportSchema,
  HighCourtReportSchema,
  CostReportSchema,
} from '../../src/schemas/reports.js';

describe('TaskSchema', () => {
  it('accepts a valid task', () => {
    const result = TaskSchema.safeParse({
      id: 't1',
      description: 'Create server',
      writes: ['src/index.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: ['Server starts on port 3000'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects task missing writes', () => {
    const result = TaskSchema.safeParse({
      id: 't1',
      description: 'Create server',
      reads: [],
      dependsOn: [],
      acceptanceCriteria: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('PlanSchema', () => {
  const validPlan = {
    id: 'p1',
    spec: 'Build a REST API',
    tasks: [{
      id: 't1',
      description: 'Create server',
      writes: ['src/index.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: ['Server starts'],
    }],
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid plan', () => {
    const result = PlanSchema.safeParse(validPlan);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('p1');
      expect(result.data.tasks).toHaveLength(1);
    }
  });

  it('rejects empty object', () => {
    const result = PlanSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects plan with invalid datetime', () => {
    const result = PlanSchema.safeParse({
      ...validPlan,
      createdAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('rejects plan where tasks is not an array', () => {
    const result = PlanSchema.safeParse({
      ...validPlan,
      tasks: 'not-an-array',
    });
    expect(result.success).toBe(false);
  });
});

describe('AnvilConfigSchema', () => {
  it('returns defaults when parsing empty object', () => {
    const config = AnvilConfigSchema.parse({});
    expect(config.projectName).toBe('anvil-project');
    expect(config.model).toBe('claude-sonnet-4-20250514');
    expect(config.maxWorkers).toBe(4);
    expect(config.anvilDir).toBe('.anvil');
  });

  it('rejects maxWorkers below 1', () => {
    const result = AnvilConfigSchema.safeParse({ maxWorkers: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects maxWorkers above 16', () => {
    const result = AnvilConfigSchema.safeParse({ maxWorkers: 17 });
    expect(result.success).toBe(false);
  });

  it('allows overriding defaults', () => {
    const config = AnvilConfigSchema.parse({
      projectName: 'my-project',
      maxWorkers: 8,
    });
    expect(config.projectName).toBe('my-project');
    expect(config.maxWorkers).toBe(8);
    expect(config.model).toBe('claude-sonnet-4-20250514');
  });
});

describe('WaveSchema', () => {
  it('accepts valid wave', () => {
    const result = WaveSchema.safeParse({
      waveNumber: 1,
      taskIds: ['t1', 't2'],
      status: 'pending',
    });
    expect(result.success).toBe(true);
  });

  it('validates status enum', () => {
    const result = WaveSchema.safeParse({
      waveNumber: 1,
      taskIds: [],
      status: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('WaveStateSchema', () => {
  it('accepts valid wave state', () => {
    const result = WaveStateSchema.safeParse({
      waves: [{
        waveNumber: 1,
        taskIds: ['t1'],
        status: 'completed',
      }],
      currentWave: 1,
    });
    expect(result.success).toBe(true);
  });
});

describe('SessionStateSchema', () => {
  it('accepts valid session', () => {
    const result = SessionStateSchema.safeParse({
      sessionId: 'sess-1',
      spec: 'Build an API',
      status: 'executing',
      waves: [{
        waveNumber: 1,
        taskIds: ['t1'],
        status: 'running',
      }],
      startedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts session with plan', () => {
    const result = SessionStateSchema.safeParse({
      sessionId: 'sess-1',
      spec: 'Build an API',
      status: 'planning',
      plan: {
        id: 'p1',
        spec: 'Build API',
        tasks: [],
        createdAt: '2026-01-01T00:00:00Z',
      },
      waves: [],
      startedAt: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});

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
