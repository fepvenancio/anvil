import { describe, it, expect } from 'vitest';
import {
  topologicalWaves,
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

describe('topologicalWaves', () => {
  it('produces 3 waves for a linear chain A->B->C', () => {
    const tasks = [
      makeTask('C', ['B']),
      makeTask('B', ['A']),
      makeTask('A'),
    ];
    const waves = topologicalWaves(tasks);
    expect(waves).toHaveLength(3);
    expect(waves[0].taskIds).toEqual(['A']);
    expect(waves[1].taskIds).toEqual(['B']);
    expect(waves[2].taskIds).toEqual(['C']);
    expect(waves[0].waveNumber).toBe(1);
    expect(waves[1].waveNumber).toBe(2);
    expect(waves[2].waveNumber).toBe(3);
  });

  it('groups independent tasks in the same wave', () => {
    // A, B independent; C depends on both; D independent
    const tasks = [
      makeTask('A'),
      makeTask('B'),
      makeTask('C', ['A', 'B']),
      makeTask('D'),
    ];
    const waves = topologicalWaves(tasks);
    expect(waves).toHaveLength(2);
    // Wave 1 should have A, B, D (all independent)
    expect(waves[0].taskIds.sort()).toEqual(['A', 'B', 'D']);
    // Wave 2 should have C
    expect(waves[1].taskIds).toEqual(['C']);
  });

  it('produces 1 wave for a single task with no deps', () => {
    const tasks = [makeTask('only')];
    const waves = topologicalWaves(tasks);
    expect(waves).toHaveLength(1);
    expect(waves[0].taskIds).toEqual(['only']);
    expect(waves[0].waveNumber).toBe(1);
    expect(waves[0].status).toBe('pending');
  });

  it('throws on circular dependency with "cycle" in message', () => {
    const tasks = [makeTask('A', ['B']), makeTask('B', ['A'])];
    expect(() => topologicalWaves(tasks)).toThrow(/cycle/i);
  });

  it('returns empty array for empty task list', () => {
    const waves = topologicalWaves([]);
    expect(waves).toEqual([]);
  });

  it('handles diamond dependency: A->C, B->C, C->D', () => {
    const tasks = [
      makeTask('A'),
      makeTask('B'),
      makeTask('C', ['A', 'B']),
      makeTask('D', ['C']),
    ];
    const waves = topologicalWaves(tasks);
    expect(waves).toHaveLength(3);
    expect(waves[0].taskIds.sort()).toEqual(['A', 'B']);
    expect(waves[1].taskIds).toEqual(['C']);
    expect(waves[2].taskIds).toEqual(['D']);
  });

  it('all waves have status pending', () => {
    const tasks = [makeTask('A'), makeTask('B', ['A'])];
    const waves = topologicalWaves(tasks);
    for (const wave of waves) {
      expect(wave.status).toBe('pending');
    }
  });
});
