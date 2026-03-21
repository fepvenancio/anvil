import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import simpleGit from 'simple-git';
import { executeInWaves } from '../../src/orchestrator/wave-runner.js';
import type { Plan } from '../../src/schemas/plan.js';
import type { AnvilConfig } from '../../src/schemas/config.js';

// Mock the worker module to avoid real Anthropic calls
vi.mock('../../src/workers/worker.js', () => ({
  executeTask: vi.fn(),
}));

// Mock chalk to avoid ESM import issues in tests
vi.mock('chalk', () => ({
  default: {
    blue: (s: string) => s,
    green: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
    yellow: (s: string) => s,
    cyan: (s: string) => s,
    bold: (s: string) => s,
  },
}));

import { executeTask } from '../../src/workers/worker.js';

const mockedExecuteTask = vi.mocked(executeTask);

function makePlan(tasks: Plan['tasks']): Plan {
  return {
    id: 'test-plan',
    spec: 'test spec',
    tasks,
    createdAt: new Date().toISOString(),
  };
}

const defaultConfig: AnvilConfig = {
  projectName: 'test-project',
  model: 'claude-sonnet-4-20250514',
  maxWorkers: 4,
  anvilDir: '.anvil',
};

describe('wave-runner integration', { timeout: 30000 }, () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'anvil-wave-runner-'));
    const git = simpleGit(tempDir);
    await git.init();
    await git.raw(['config', 'user.email', 'test@anvil.dev']);
    await git.raw(['config', 'user.name', 'Anvil Test']);
    await writeFile(join(tempDir, 'README.md'), '# Test Repo');
    await git.add('.');
    await git.commit('initial commit');

    mockedExecuteTask.mockReset();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates 2 waves for 2 independent + 1 dependent task and runs in order', async () => {
    // Mock executeTask to write a file for each task
    mockedExecuteTask.mockImplementation(async (task, worktreePath) => {
      await writeFile(join(worktreePath, `${task.id}.ts`), `export const ${task.id} = true;`);
      return { taskId: task.id, success: true, filesWritten: [`${task.id}.ts`] };
    });

    const plan = makePlan([
      { id: 'A', description: 'Task A', writes: ['A.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
      { id: 'B', description: 'Task B', writes: ['B.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
      { id: 'C', description: 'Task C', writes: ['C.ts'], reads: [], dependsOn: ['A', 'B'], acceptanceCriteria: [] },
    ]);

    const result = await executeInWaves(plan, defaultConfig, { baseDir: tempDir });

    expect(result.success).toBe(true);
    expect(result.waveReports).toHaveLength(2);
    expect(result.waveReports[0].waveNumber).toBe(1);
    expect(result.waveReports[1].waveNumber).toBe(2);
    expect(result.failedTasks).toEqual([]);
  });

  it('merges task branches to main after wave completes', async () => {
    mockedExecuteTask.mockImplementation(async (task, worktreePath) => {
      await writeFile(join(worktreePath, `${task.id}.ts`), `export const ${task.id} = true;`);
      return { taskId: task.id, success: true, filesWritten: [`${task.id}.ts`] };
    });

    const plan = makePlan([
      { id: 'merge-test', description: 'Merge test', writes: ['merge-test.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
    ]);

    await executeInWaves(plan, defaultConfig, { baseDir: tempDir });

    // Verify the file is accessible from main branch
    const git = simpleGit(tempDir);
    const content = await git.show(['HEAD:merge-test.ts']);
    expect(content).toContain('export const');
  });

  it('leaves no stale worktrees after execution', async () => {
    mockedExecuteTask.mockImplementation(async (task, worktreePath) => {
      await writeFile(join(worktreePath, `${task.id}.ts`), `// ${task.id}`);
      return { taskId: task.id, success: true, filesWritten: [`${task.id}.ts`] };
    });

    const plan = makePlan([
      { id: 'wt-1', description: 'WT test 1', writes: ['wt-1.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
      { id: 'wt-2', description: 'WT test 2', writes: ['wt-2.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
    ]);

    await executeInWaves(plan, defaultConfig, { baseDir: tempDir });

    // git worktree list should show only the main worktree
    const git = simpleGit(tempDir);
    const worktreeList = await git.raw(['worktree', 'list']);
    const lines = worktreeList.trim().split('\n');
    expect(lines).toHaveLength(1); // Only the main worktree
  });

  it('failed task does not prevent other wave tasks from completing', async () => {
    mockedExecuteTask.mockImplementation(async (task, worktreePath) => {
      if (task.id === 'fail') {
        throw new Error('deliberate failure');
      }
      await writeFile(join(worktreePath, `${task.id}.ts`), `// ${task.id}`);
      return { taskId: task.id, success: true, filesWritten: [`${task.id}.ts`] };
    });

    const plan = makePlan([
      { id: 'ok-1', description: 'OK 1', writes: ['ok-1.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
      { id: 'fail', description: 'Fail', writes: ['fail.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
      { id: 'ok-2', description: 'OK 2', writes: ['ok-2.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
    ]);

    const result = await executeInWaves(plan, defaultConfig, { baseDir: tempDir });

    // ok-1 and ok-2 should have succeeded
    const successIds = result.results.filter((r) => r.success).map((r) => r.taskId);
    expect(successIds).toContain('ok-1');
    expect(successIds).toContain('ok-2');
    expect(result.failedTasks).toContain('fail');
  });

  it('halts progression when wave has failures', async () => {
    mockedExecuteTask.mockImplementation(async (task, worktreePath) => {
      if (task.id === 'wave1-fail') {
        throw new Error('wave 1 failure');
      }
      await writeFile(join(worktreePath, `${task.id}.ts`), `// ${task.id}`);
      return { taskId: task.id, success: true, filesWritten: [`${task.id}.ts`] };
    });

    const plan = makePlan([
      { id: 'wave1-ok', description: 'W1 OK', writes: ['wave1-ok.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
      { id: 'wave1-fail', description: 'W1 Fail', writes: ['wave1-fail.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
      { id: 'wave2-task', description: 'W2', writes: ['wave2-task.ts'], reads: [], dependsOn: ['wave1-ok', 'wave1-fail'], acceptanceCriteria: [] },
    ]);

    const result = await executeInWaves(plan, defaultConfig, { baseDir: tempDir });

    expect(result.success).toBe(false);
    expect(result.haltedAtWave).toBe(1);
    // Wave 2 should NOT have executed
    expect(result.waveReports).toHaveLength(1);
    // wave2-task should not be in results
    expect(result.results.map((r) => r.taskId)).not.toContain('wave2-task');
  });

  it('result object contains per-task results with success/failure status', async () => {
    mockedExecuteTask.mockImplementation(async (task, worktreePath) => {
      if (task.id === 'bad') {
        return { taskId: task.id, success: false, filesWritten: [], error: 'bad code' };
      }
      await writeFile(join(worktreePath, `${task.id}.ts`), `// ${task.id}`);
      return { taskId: task.id, success: true, filesWritten: [`${task.id}.ts`] };
    });

    const plan = makePlan([
      { id: 'good', description: 'Good task', writes: ['good.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
      { id: 'bad', description: 'Bad task', writes: ['bad.ts'], reads: [], dependsOn: [], acceptanceCriteria: [] },
    ]);

    const result = await executeInWaves(plan, defaultConfig, { baseDir: tempDir });

    expect(result.results).toHaveLength(2);
    const goodResult = result.results.find((r) => r.taskId === 'good');
    const badResult = result.results.find((r) => r.taskId === 'bad');
    expect(goodResult?.success).toBe(true);
    expect(badResult?.success).toBe(false);
    expect(badResult?.error).toBe('bad code');
    expect(result.waveReports[0].merged).toContain('good');
    expect(result.waveReports[0].failed).toContain('bad');
  });
});
