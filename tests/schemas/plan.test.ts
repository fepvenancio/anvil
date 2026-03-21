import { describe, it, expect } from 'vitest';
import { PlanSchema, TaskSchema } from '../../src/schemas/plan.js';
import { AnvilConfigSchema } from '../../src/schemas/config.js';

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
    expect(config.model).toBe('claude-sonnet-4-6-20250520');
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
    expect(config.model).toBe('claude-sonnet-4-6-20250520');
  });
});
