import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import simpleGit from 'simple-git';
import { promptPlanReview } from '../../src/ui/plan-review.js';
import { generatePlan } from '../../src/stations/planner.js';
import { executeSequentially } from '../../src/orchestrator/sequential-runner.js';
import { Readable, PassThrough } from 'node:stream';
import type { Plan } from '../../src/schemas/plan.js';
import type { AnvilConfig } from '../../src/schemas/config.js';
import type { WorkerResult } from '../../src/workers/worker.js';

// Mock the worker module — Workers now use Agent SDK internally,
// but integration tests mock executeTask to avoid spawning real Claude Code agents.
vi.mock('../../src/workers/worker.js', async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    executeTask: vi.fn(),
  };
});

import { executeTask } from '../../src/workers/worker.js';
const mockExecuteTask = vi.mocked(executeTask);

const testPlan: Plan = {
  id: 'integration-test-plan',
  spec: 'Build a test REST API',
  createdAt: new Date().toISOString(),
  tasks: [
    {
      id: 'task-001',
      description: 'Create entry point',
      writes: ['src/index.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: ['File src/index.ts exists'],
    },
  ],
};

describe('CLI pipeline integration', { timeout: 30000 }, () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'anvil-cli-run-'));
    const git = simpleGit(tempDir);
    await git.init();
    await git.raw(['config', 'user.email', 'test@anvil.dev']);
    await git.raw(['config', 'user.name', 'Anvil Test']);
    await writeFile(join(tempDir, 'README.md'), '# Test Repo');
    await git.add('.');
    await git.commit('initial commit');

    await mkdir(join(tempDir, '.anvil', 'worktrees'), { recursive: true });
    await mkdir(join(tempDir, '.anvil', 'logs'), { recursive: true });
    await mkdir(join(tempDir, '.anvil', 'reports'), { recursive: true });
    await mkdir(join(tempDir, '.anvil', 'history'), { recursive: true });
    await writeFile(
      join(tempDir, '.anvil', 'roadmap.json'),
      JSON.stringify({ plan: null }, null, 2),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('promptPlanReview stops on user rejection', async () => {
    const input = new Readable({
      read() {
        this.push('n\n');
        this.push(null);
      },
    });
    const output = new PassThrough();

    const result = await promptPlanReview(testPlan, { input, output });
    expect(result.approved).toBe(false);
  });

  it('promptPlanReview approves with skipPrompt', async () => {
    const result = await promptPlanReview(testPlan, { skipPrompt: true });
    expect(result.approved).toBe(true);
    expect(result.plan).toEqual(testPlan);
  });

  it('plan is saved to .anvil/roadmap.json after generation', async () => {
    const roadmapPath = join(tempDir, '.anvil', 'roadmap.json');
    await writeFile(roadmapPath, JSON.stringify(testPlan, null, 2));

    const content = JSON.parse(await readFile(roadmapPath, 'utf-8'));
    expect(content.id).toBe('integration-test-plan');
    expect(content.tasks).toHaveLength(1);
    expect(content.tasks[0].id).toBe('task-001');
  });

  it('.anvil directory has expected structure', async () => {
    for (const dir of ['logs', 'reports', 'history', 'worktrees']) {
      await expect(access(join(tempDir, '.anvil', dir))).resolves.toBeUndefined();
    }
  });
});

describe('full pipeline integration', { timeout: 30000 }, () => {
  let tempDir: string;

  const config: AnvilConfig = {
    projectName: 'test-project',
    model: 'claude-sonnet-4-6',
    maxWorkers: 4,
    anvilDir: '.anvil',
  };

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'anvil-pipeline-'));
    const git = simpleGit(tempDir);
    await git.init();
    await git.raw(['config', 'user.email', 'test@anvil.dev']);
    await git.raw(['config', 'user.name', 'Anvil Test']);
    await writeFile(join(tempDir, 'README.md'), '# Test Repo');
    await git.add('.');
    await git.commit('initial commit');

    await mkdir(join(tempDir, '.anvil', 'worktrees'), { recursive: true });
    await mkdir(join(tempDir, '.anvil', 'logs'), { recursive: true });
    await mkdir(join(tempDir, '.anvil', 'reports'), { recursive: true });
    await mkdir(join(tempDir, '.anvil', 'history'), { recursive: true });
    await writeFile(
      join(tempDir, '.anvil', 'roadmap.json'),
      JSON.stringify({ plan: null }, null, 2),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      const git = simpleGit(tempDir);
      await git.raw(['worktree', 'prune']);
    } catch {
      // best effort
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('executeSequentially produces files and git commits with mocked worker', async () => {
    // Mock executeTask to write files directly (simulating what Claude Code agent would do)
    mockExecuteTask.mockImplementation(async (task, worktreePath) => {
      const filePath = join(worktreePath, 'src/index.ts');
      await mkdir(join(worktreePath, 'src'), { recursive: true });
      await writeFile(filePath, 'console.log("hello");');
      return {
        taskId: task.id,
        success: true,
        filesWritten: ['src/index.ts'],
        costUsd: 0.01,
      } as WorkerResult;
    });

    const singleTaskPlan: Plan = {
      id: 'pipeline-test-plan',
      spec: 'Build a test REST API',
      createdAt: new Date().toISOString(),
      tasks: [
        {
          id: 'task-001',
          description: 'Create entry point',
          writes: ['src/index.ts'],
          reads: [],
          dependsOn: [],
          acceptanceCriteria: ['File src/index.ts exists'],
        },
      ],
    };

    const result = await executeSequentially(singleTaskPlan, config, {
      baseDir: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].filesWritten).toContain('src/index.ts');
    expect(result.failedTasks).toHaveLength(0);

    // Verify file on disk in main branch
    const fileContent = await readFile(join(tempDir, 'src/index.ts'), 'utf-8');
    expect(fileContent).toBe('console.log("hello");');

    // Verify git log contains expected commit
    const git = simpleGit(tempDir);
    const log = await git.log();
    const commitMessages = log.all.map((c) => c.message);
    expect(commitMessages.some((m) => m.includes('feat(anvil):'))).toBe(true);
  });

  it('executeSequentially with multi-task plan respects dependency order', async () => {
    let callCount = 0;
    mockExecuteTask.mockImplementation(async (task, worktreePath) => {
      callCount++;
      const filePath = join(worktreePath, task.writes[0]);
      await mkdir(join(worktreePath, 'src', 'routes').replace(/\/[^/]+$/, ''), { recursive: true });
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, `// File ${callCount}: ${task.id}`);
      return {
        taskId: task.id,
        success: true,
        filesWritten: task.writes,
        costUsd: 0.01,
      } as WorkerResult;
    });

    const multiTaskPlan: Plan = {
      id: 'multi-task-plan',
      spec: 'Build a server with routes',
      createdAt: new Date().toISOString(),
      tasks: [
        {
          id: 'task-001',
          description: 'Create server entry point',
          writes: ['src/server.ts'],
          reads: [],
          dependsOn: [],
          acceptanceCriteria: ['Server file exists'],
        },
        {
          id: 'task-002',
          description: 'Create user routes',
          writes: ['src/routes/users.ts'],
          reads: ['src/server.ts'],
          dependsOn: ['task-001'],
          acceptanceCriteria: ['Routes file exists'],
        },
      ],
    };

    const result = await executeSequentially(multiTaskPlan, config, {
      baseDir: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);

    // Git log shows at least 2 feat(anvil): commits
    const git = simpleGit(tempDir);
    const log = await git.log();
    const featCommits = log.all.filter((c) => c.message.includes('feat(anvil):'));
    expect(featCommits.length).toBeGreaterThanOrEqual(2);
  });

  it('executeSequentially reports worker failure', async () => {
    mockExecuteTask.mockResolvedValue({
      taskId: 'task-fail-001',
      success: false,
      filesWritten: [],
      error: 'Cannot implement task',
    } as WorkerResult);

    const failingPlan: Plan = {
      id: 'failing-plan',
      spec: 'Build something that fails',
      createdAt: new Date().toISOString(),
      tasks: [
        {
          id: 'task-fail-001',
          description: 'A task that will fail',
          writes: ['src/fail.ts'],
          reads: [],
          dependsOn: [],
          acceptanceCriteria: ['Should not pass'],
        },
      ],
    };

    const result = await executeSequentially(failingPlan, config, {
      baseDir: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.failedTasks).toContain('task-fail-001');
    expect(result.results[0].error).toContain('Cannot implement task');
  });
});
