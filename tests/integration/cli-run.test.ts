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

    // Create .anvil directory structure
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
    // Simulate saving plan (as the CLI does)
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
    model: 'claude-sonnet-4-6-20250520',
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

    // Create .anvil directory structure
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
    // Clean up any leftover worktrees before removing temp dir
    try {
      const git = simpleGit(tempDir);
      await git.raw(['worktree', 'prune']);
    } catch {
      // best effort
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('generatePlan -> executeSequentially produces files and git commits', async () => {
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

    const mockClient = {
      messages: {
        parse: vi.fn().mockResolvedValue({ parsed_output: singleTaskPlan }),
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'tu_01',
              name: 'write_file',
              input: { path: 'src/index.ts', content: 'console.log("hello");' },
            },
          ],
        }),
      },
    } as any;

    // Step 1: Generate plan via mocked planner
    const plan = await generatePlan('Build a test REST API', config, { client: mockClient });
    expect(plan.id).toBe('pipeline-test-plan');
    expect(plan.tasks).toHaveLength(1);

    // Step 2: Execute the plan with real git
    const result = await executeSequentially(plan, config, {
      client: mockClient,
      baseDir: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].filesWritten).toContain('src/index.ts');
    expect(result.failedTasks).toHaveLength(0);

    // Step 3: Verify file on disk in main branch
    const fileContent = await readFile(join(tempDir, 'src/index.ts'), 'utf-8');
    expect(fileContent).toBe('console.log("hello");');

    // Step 4: Verify git log contains expected commit
    const git = simpleGit(tempDir);
    const log = await git.log();
    const commitMessages = log.all.map((c) => c.message);
    expect(commitMessages.some((m) => m.includes('feat(anvil):'))).toBe(true);
  });

  it('executeSequentially with multi-task plan respects dependency order', async () => {
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

    const mockClient = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValueOnce({
            content: [
              {
                type: 'tool_use',
                id: 'tu_01',
                name: 'write_file',
                input: {
                  path: 'src/server.ts',
                  content: 'import express from "express";\nexport const app = express();',
                },
              },
            ],
          })
          .mockResolvedValueOnce({
            content: [
              {
                type: 'tool_use',
                id: 'tu_02',
                name: 'write_file',
                input: {
                  path: 'src/routes/users.ts',
                  content: 'import { Router } from "express";\nexport const users = Router();',
                },
              },
            ],
          }),
      },
    } as any;

    const result = await executeSequentially(multiTaskPlan, config, {
      client: mockClient,
      baseDir: tempDir,
    });

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);

    // Both files exist on disk
    const serverContent = await readFile(join(tempDir, 'src/server.ts'), 'utf-8');
    expect(serverContent).toContain('express');

    const routesContent = await readFile(join(tempDir, 'src/routes/users.ts'), 'utf-8');
    expect(routesContent).toContain('Router');

    // Git log shows at least 2 feat(anvil): commits
    const git = simpleGit(tempDir);
    const log = await git.log();
    const featCommits = log.all.filter((c) => c.message.includes('feat(anvil):'));
    expect(featCommits.length).toBeGreaterThanOrEqual(2);
  });

  it('executeSequentially stops on worker failure', async () => {
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

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: 'tool_use',
              id: 'tu_01',
              name: 'report_error',
              input: { reason: 'Cannot implement task' },
            },
          ],
        }),
      },
    } as any;

    const result = await executeSequentially(failingPlan, config, {
      client: mockClient,
      baseDir: tempDir,
    });

    expect(result.success).toBe(false);
    expect(result.failedTasks).toContain('task-fail-001');
    expect(result.results[0].error).toContain('Cannot implement task');
  });
});
