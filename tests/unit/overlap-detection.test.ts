import { describe, it, expect } from 'vitest';
import {
  detectWriteOverlaps,
  validatePlanFull,
} from '../../src/core/validator.js';
import type { Task } from '../../src/schemas/plan.js';

function makeTask(
  id: string,
  writes: string[],
  dependsOn: string[] = [],
): Task {
  return {
    id,
    description: `Task ${id}`,
    writes,
    reads: [],
    dependsOn,
    acceptanceCriteria: [],
  };
}

describe('detectWriteOverlaps', () => {
  it('returns empty array when tasks have disjoint writes', () => {
    const tasks = [
      makeTask('t1', ['src/a.ts']),
      makeTask('t2', ['src/b.ts']),
    ];
    expect(detectWriteOverlaps(tasks)).toEqual([]);
  });

  it('detects a single overlap between two tasks', () => {
    const tasks = [
      makeTask('t1', ['src/index.ts', 'src/a.ts']),
      makeTask('t2', ['src/index.ts', 'src/b.ts']),
    ];
    const overlaps = detectWriteOverlaps(tasks);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toEqual({
      taskA: 't1',
      taskB: 't2',
      overlappingFiles: ['src/index.ts'],
    });
  });

  it('detects multiple pairwise overlaps among three tasks', () => {
    const tasks = [
      makeTask('t1', ['src/shared.ts']),
      makeTask('t2', ['src/shared.ts']),
      makeTask('t3', ['src/shared.ts']),
    ];
    const overlaps = detectWriteOverlaps(tasks);
    // t1-t2, t1-t3, t2-t3
    expect(overlaps).toHaveLength(3);
  });

  it('returns empty array when tasks have empty writes', () => {
    const tasks = [makeTask('t1', []), makeTask('t2', [])];
    expect(detectWriteOverlaps(tasks)).toEqual([]);
  });
});

describe('validatePlanFull', () => {
  const basePlan = {
    id: 'plan-1',
    spec: 'Build something',
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('accepts a valid plan with no overlaps', () => {
    const plan = {
      ...basePlan,
      tasks: [
        makeTask('t1', ['src/a.ts']),
        makeTask('t2', ['src/b.ts']),
      ],
    };
    const result = validatePlanFull(plan);
    expect(result.valid).toBe(true);
    expect(result.plan).toBeDefined();
  });

  it('rejects a plan with overlapping writes', () => {
    const plan = {
      ...basePlan,
      tasks: [
        makeTask('t1', ['src/index.ts']),
        makeTask('t2', ['src/index.ts']),
      ],
    };
    const result = validatePlanFull(plan);
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0]).toContain('Write overlap');
    expect(result.errors![0]).toContain('src/index.ts');
  });

  it('rejects a plan with invalid dependency references', () => {
    const plan = {
      ...basePlan,
      tasks: [makeTask('t1', ['src/a.ts'], ['nonexistent'])],
    };
    const result = validatePlanFull(plan);
    expect(result.valid).toBe(false);
    expect(result.errors![0]).toContain('does not exist');
  });

  it('rejects an invalid schema before checking overlaps', () => {
    const result = validatePlanFull({ id: 'bad' });
    expect(result.valid).toBe(false);
  });
});
