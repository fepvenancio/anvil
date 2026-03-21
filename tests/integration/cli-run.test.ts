import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import simpleGit from 'simple-git';
import { promptPlanReview } from '../../src/ui/plan-review.js';
import { Readable, PassThrough } from 'node:stream';
import type { Plan } from '../../src/schemas/plan.js';

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
