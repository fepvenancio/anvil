import { simpleGit, type SimpleGit } from 'simple-git';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export class WorktreeManager {
  private git: SimpleGit;
  private baseDir: string;
  private runId: string;
  private activeWorktrees: Map<string, { worktreePath: string; branch: string }>;

  constructor(baseDir: string, runId?: string) {
    this.baseDir = baseDir;
    this.runId = runId ?? randomUUID();
    this.git = simpleGit(baseDir);
    this.activeWorktrees = new Map();
  }

  async create(taskId: string): Promise<{ worktreePath: string; branch: string }> {
    const branch = `anvil/run-${this.runId}/task-${taskId}`;
    const worktreePath = join(this.baseDir, '.anvil', 'worktrees', `task-${taskId}`);
    await this.git.raw(['worktree', 'add', worktreePath, '-b', branch]);
    this.activeWorktrees.set(taskId, { worktreePath, branch });
    return { worktreePath, branch };
  }

  async commitAndMerge(taskId: string, message: string): Promise<void> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      throw new Error(`No active worktree for task ${taskId}`);
    }
    const { worktreePath, branch } = info;
    const worktreeGit = simpleGit(worktreePath);
    await worktreeGit.add('.');
    const status = await worktreeGit.status();
    if (status.staged.length === 0) {
      return; // No changes to commit
    }
    await worktreeGit.commit(message);
    await this.git.merge([branch, '--no-ff']);
  }

  async cleanup(taskId: string): Promise<void> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      return; // Defensive for signal handlers
    }
    const { worktreePath, branch } = info;

    try {
      await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
    } catch {
      try {
        await rm(worktreePath, { recursive: true, force: true });
        await this.git.raw(['worktree', 'prune']);
      } catch {
        // Best effort cleanup
      }
    }

    try {
      await this.git.branch(['-D', branch]);
    } catch {
      // Branch may already be deleted
    }

    this.activeWorktrees.delete(taskId);
  }

  async pruneStale(): Promise<void> {
    await this.git.raw(['worktree', 'prune']);
  }

  async cleanupAll(): Promise<void> {
    const taskIds = [...this.activeWorktrees.keys()];
    for (const taskId of taskIds) {
      await this.cleanup(taskId);
    }
  }
}

export async function validateTouchMap(
  worktreePath: string,
  writes: string[],
): Promise<{ valid: boolean; violations: string[] }> {
  const worktreeGit = simpleGit(worktreePath);
  const diff = await worktreeGit.diff(['--name-only', 'HEAD']);
  const untracked = await worktreeGit.raw(['ls-files', '--others', '--exclude-standard']);
  const allChanged = [...diff.split('\n'), ...untracked.split('\n')].filter(
    (f) => f.length > 0,
  );
  const writesSet = new Set(writes);
  const violations = allChanged.filter((f) => !writesSet.has(f));
  return { valid: violations.length === 0, violations };
}
