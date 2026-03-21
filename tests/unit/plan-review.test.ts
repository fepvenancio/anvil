import { describe, it, expect } from 'vitest';
import { Readable, PassThrough } from 'node:stream';
import { promptPlanReview, displayPlanSummary } from '../../src/ui/plan-review.js';
import type { Plan } from '../../src/schemas/plan.js';

const testPlan: Plan = {
  id: 'test-plan-id',
  spec: 'Build a test app',
  createdAt: new Date().toISOString(),
  tasks: [
    {
      id: 'task-001',
      description: 'Create index.ts',
      writes: ['src/index.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: ['File exists'],
    },
    {
      id: 'task-002',
      description: 'Create utils.ts',
      writes: ['src/utils.ts'],
      reads: ['src/index.ts'],
      dependsOn: ['task-001'],
      acceptanceCriteria: ['File exists'],
    },
  ],
};

function createMockStdin(input: string): Readable {
  const stream = new Readable({
    read() {
      this.push(input);
      this.push(null);
    },
  });
  return stream;
}

function createMockStdout(): PassThrough {
  return new PassThrough();
}

describe('promptPlanReview', () => {
  it('returns approved: true on Enter (default Y)', async () => {
    const result = await promptPlanReview(testPlan, {
      input: createMockStdin('\n'),
      output: createMockStdout(),
    });
    expect(result.approved).toBe(true);
    expect(result.plan).toEqual(testPlan);
  });

  it('returns approved: true on "Y"', async () => {
    const result = await promptPlanReview(testPlan, {
      input: createMockStdin('Y\n'),
      output: createMockStdout(),
    });
    expect(result.approved).toBe(true);
  });

  it('returns approved: false on "n"', async () => {
    const result = await promptPlanReview(testPlan, {
      input: createMockStdin('n\n'),
      output: createMockStdout(),
    });
    expect(result.approved).toBe(false);
  });

  it('returns approved: false on "N"', async () => {
    const result = await promptPlanReview(testPlan, {
      input: createMockStdin('N\n'),
      output: createMockStdout(),
    });
    expect(result.approved).toBe(false);
  });

  it('skipPrompt bypasses prompt and returns approved: true', async () => {
    const result = await promptPlanReview(testPlan, {
      skipPrompt: true,
    });
    expect(result.approved).toBe(true);
    expect(result.plan).toEqual(testPlan);
  });
});

describe('displayPlanSummary', () => {
  it('outputs task details', () => {
    const output = createMockStdout();
    displayPlanSummary(testPlan, output);

    const text = output.read()?.toString() ?? '';
    expect(text).toContain('task-001');
    expect(text).toContain('task-002');
    expect(text).toContain('Create index.ts');
    expect(text).toContain('Create utils.ts');
    expect(text).toContain('Plan Summary');
  });
});
