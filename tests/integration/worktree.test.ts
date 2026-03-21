import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import simpleGit from 'simple-git';
import { WorktreeManager } from '../../src/git/worktree-manager.js';

describe('WorktreeManager', { timeout: 15000 }, () => {
  let tempDir: string;
  let manager: WorktreeManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'anvil-worktree-'));
    const git = simpleGit(tempDir);
    await git.init();
    await git.raw(['config', 'user.email', 'test@anvil.dev']);
    await git.raw(['config', 'user.name', 'Anvil Test']);
    // Worktrees require at least one commit
    await writeFile(join(tempDir, 'README.md'), '# Test Repo');
    await git.add('.');
    await git.commit('initial commit');
    manager = new WorktreeManager(tempDir, 'test-run-id');
  });

  afterEach(async () => {
    try {
      await manager.cleanupAll();
    } catch {
      // Best effort
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates worktree with dedicated branch', async () => {
    const { worktreePath, branch } = await manager.create('001');

    // Worktree path should exist on disk
    await expect(access(worktreePath)).resolves.toBeUndefined();

    // Branch should exist
    const git = simpleGit(tempDir);
    const branches = await git.branch(['--list']);
    expect(branches.all).toContain(branch);
    expect(branch).toContain('anvil/run-test-run-id/task-001');
  });

  it('commits and merges changes to main', async () => {
    const { worktreePath } = await manager.create('002');

    // Write a file in the worktree
    await writeFile(join(worktreePath, 'new-file.ts'), 'export const value = 42;');

    await manager.commitAndMerge('002', 'feat: add new-file', ['new-file.ts']);

    // Verify file exists in the main branch
    const git = simpleGit(tempDir);
    const content = await git.show(['HEAD:new-file.ts']);
    expect(content).toContain('export const value = 42');
  });

  it('cleanup removes worktree and branch', async () => {
    const { worktreePath, branch } = await manager.create('003');

    await manager.cleanup('003');

    // Worktree path should not exist
    await expect(access(worktreePath)).rejects.toThrow();

    // Branch should not exist
    const git = simpleGit(tempDir);
    const branches = await git.branch(['--list']);
    expect(branches.all).not.toContain(branch);
  });

  it('pruneStale runs without error on clean repo', async () => {
    await expect(manager.pruneStale()).resolves.toBeUndefined();
  });
});
