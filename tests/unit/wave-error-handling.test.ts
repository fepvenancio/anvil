import { describe, it, expect, vi } from 'vitest';
import type { WorkerResult } from '../../src/workers/worker.js';
import pLimit from 'p-limit';

/**
 * These tests validate the error-isolation pattern used by the wave runner:
 * Each task is wrapped in try/catch inside p-limit, so one failure
 * does not crash other tasks in the same wave.
 */

interface MockTaskRunner {
  (taskId: string): Promise<WorkerResult>;
}

/**
 * Simulates the wave execution pattern: run tasks in parallel with p-limit,
 * wrapping each in try/catch to isolate failures.
 */
async function executeWavePattern(
  taskIds: string[],
  runner: MockTaskRunner,
  concurrency: number,
): Promise<{ successes: WorkerResult[]; failures: WorkerResult[] }> {
  const limit = pLimit(concurrency);
  const results: WorkerResult[] = [];

  await Promise.all(
    taskIds.map((taskId) =>
      limit(async () => {
        try {
          const result = await runner(taskId);
          results.push(result);
        } catch (err) {
          results.push({
            taskId,
            success: false,
            filesWritten: [],
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    ),
  );

  const successes = results.filter((r) => r.success);
  const failures = results.filter((r) => !r.success);
  return { successes, failures };
}

describe('wave error handling pattern', () => {
  it('when 1 of 3 tasks fails, the other 2 still complete', async () => {
    const runner: MockTaskRunner = vi.fn(async (taskId: string) => {
      if (taskId === 'fail-task') {
        throw new Error('deliberate failure');
      }
      return { taskId, success: true, filesWritten: [`${taskId}.ts`] };
    });

    const { successes, failures } = await executeWavePattern(
      ['task-1', 'fail-task', 'task-3'],
      runner,
      4,
    );

    expect(successes).toHaveLength(2);
    expect(failures).toHaveLength(1);
    // All 3 tasks were attempted
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it('failed task is excluded from merged list', async () => {
    const runner: MockTaskRunner = vi.fn(async (taskId: string) => {
      if (taskId === 'broken') {
        return { taskId, success: false, filesWritten: [], error: 'compile error' };
      }
      return { taskId, success: true, filesWritten: [`${taskId}.ts`] };
    });

    const { successes, failures } = await executeWavePattern(
      ['good-1', 'broken', 'good-2'],
      runner,
      4,
    );

    const mergedIds = successes.map((r) => r.taskId);
    expect(mergedIds).not.toContain('broken');
    expect(mergedIds).toContain('good-1');
    expect(mergedIds).toContain('good-2');
    expect(failures[0].taskId).toBe('broken');
  });

  it('failed task error message is captured in results', async () => {
    const runner: MockTaskRunner = vi.fn(async (taskId: string) => {
      if (taskId === 'crash') {
        throw new Error('segfault simulation');
      }
      return { taskId, success: true, filesWritten: [] };
    });

    const { failures } = await executeWavePattern(['crash'], runner, 4);

    expect(failures).toHaveLength(1);
    expect(failures[0].error).toBe('segfault simulation');
    expect(failures[0].taskId).toBe('crash');
  });

  it('wave reports both successes and failures together', async () => {
    const runner: MockTaskRunner = vi.fn(async (taskId: string) => {
      if (taskId === 'bad') {
        throw new Error('bad task');
      }
      return { taskId, success: true, filesWritten: [`${taskId}.ts`] };
    });

    const { successes, failures } = await executeWavePattern(
      ['ok-1', 'bad', 'ok-2'],
      runner,
      4,
    );

    expect(successes).toHaveLength(2);
    expect(failures).toHaveLength(1);
    // Total results = successes + failures
    expect(successes.length + failures.length).toBe(3);
  });
});
