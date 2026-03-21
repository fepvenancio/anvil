import { describe, it, expect } from 'vitest';
import {
  topologicalSort,
  validateDependencyRefs,
} from '../../src/core/topological-sort.js';
import type { Task } from '../../src/schemas/plan.js';

function makeTask(
  id: string,
  dependsOn: string[] = [],
  writes: string[] = [],
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

describe('topologicalSort', () => {
  it('sorts a linear chain A -> B -> C', () => {
    const tasks = [
      makeTask('C', ['B']),
      makeTask('B', ['A']),
      makeTask('A'),
    ];
    const sorted = topologicalSort(tasks);
    const ids = sorted.map((t) => t.id);
    expect(ids).toEqual(['A', 'B', 'C']);
  });

  it('handles independent tasks (no deps)', () => {
    const tasks = [makeTask('A'), makeTask('B')];
    const sorted = topologicalSort(tasks);
    expect(sorted).toHaveLength(2);
    const ids = sorted.map((t) => t.id);
    expect(ids).toContain('A');
    expect(ids).toContain('B');
  });

  it('sorts a diamond: A -> B, A -> C, B -> D, C -> D', () => {
    const tasks = [
      makeTask('D', ['B', 'C']),
      makeTask('C', ['A']),
      makeTask('B', ['A']),
      makeTask('A'),
    ];
    const sorted = topologicalSort(tasks);
    const ids = sorted.map((t) => t.id);

    // A must come before B and C; B and C must come before D
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('B'));
    expect(ids.indexOf('A')).toBeLessThan(ids.indexOf('C'));
    expect(ids.indexOf('B')).toBeLessThan(ids.indexOf('D'));
    expect(ids.indexOf('C')).toBeLessThan(ids.indexOf('D'));
  });

  it('detects a cycle: A -> B -> A', () => {
    const tasks = [makeTask('A', ['B']), makeTask('B', ['A'])];
    expect(() => topologicalSort(tasks)).toThrow(
      'Dependency cycle detected among tasks: A, B',
    );
  });
});

describe('validateDependencyRefs', () => {
  it('returns empty array for valid references', () => {
    const tasks = [makeTask('A'), makeTask('B', ['A'])];
    expect(validateDependencyRefs(tasks)).toEqual([]);
  });

  it('returns error for non-existent dependency', () => {
    const tasks = [makeTask('A', ['nonexistent'])];
    const errors = validateDependencyRefs(tasks);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('nonexistent');
    expect(errors[0]).toContain('does not exist');
  });
});
