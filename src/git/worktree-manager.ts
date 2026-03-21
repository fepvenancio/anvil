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

  /**
   * Commits staged changes in the worktree for the given task.
   * Separated from merge for wave-based execution.
   * Returns true if changes were committed, false if nothing to commit.
   */
  async commitInWorktree(taskId: string, message: string): Promise<boolean> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      throw new Error(`No active worktree for task ${taskId}`);
    }
    const { worktreePath } = info;
    const worktreeGit = simpleGit(worktreePath);
    await worktreeGit.add('.');
    const status = await worktreeGit.status();
    if (status.staged.length === 0) {
      return false;
    }
    await worktreeGit.commit(message);
    return true;
  }

  /**
   * Merges branches for the given taskIds to main in sorted order (deterministic).
   * On merge conflict, aborts merge and records taskId as failed.
   * Does NOT clean up worktrees (caller handles that).
   */
  async mergeWaveBranches(
    taskIds: string[],
  ): Promise<{ merged: string[]; failed: string[] }> {
    const merged: string[] = [];
    const failed: string[] = [];

    // Sort for deterministic merge order
    const sorted = [...taskIds].sort();

    for (const taskId of sorted) {
      const info = this.activeWorktrees.get(taskId);
      if (!info) {
        failed.push(taskId);
        continue;
      }
      try {
        await this.git.merge([info.branch, '--no-ff']);
        merged.push(taskId);
      } catch {
        // Merge conflict -- abort and record as failed
        try {
          await this.git.merge(['--abort']);
        } catch {
          // Already aborted or not in merge state
        }
        failed.push(taskId);
      }
    }

    return { merged, failed };
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

// Files commonly generated as side effects (npm install, build tools, etc.)
// These are NOT intentional writes and should be ignored by touch-map validation.
const IGNORED_PATTERNS = [
  'package-lock.json',
  'node_modules/',
  '.gitignore',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'tsconfig.tsbuildinfo',
  '.DS_Store',
];

function isIgnoredFile(file: string): boolean {
  return IGNORED_PATTERNS.some((pattern) =>
    pattern.endsWith('/')
      ? file.startsWith(pattern) || file === pattern.slice(0, -1)
      : file === pattern,
  );
}

export async function validateTouchMap(
  worktreePath: string,
  writes: string[],
): Promise<{ valid: boolean; violations: string[] }> {
  const worktreeGit = simpleGit(worktreePath);
  // Use diff against HEAD for tracked changes
  let diff = '';
  try {
    diff = await worktreeGit.diff(['--name-only', 'HEAD']);
  } catch {
    // HEAD may not exist in fresh repos
  }
  // For untracked files, exclude common generated dirs at the git level
  const untracked = await worktreeGit.raw([
    'ls-files', '--others', '--exclude-standard',
    '--exclude', 'node_modules',
    '--exclude', '.anvil',
    '--exclude', 'dist',
  ]);
  const allChanged = [...diff.split('\n'), ...untracked.split('\n')].filter(
    (f) => f.length > 0,
  );
  const writesSet = new Set(writes);
  const violations = allChanged.filter((f) => !writesSet.has(f) && !isIgnoredFile(f));
  return { valid: violations.length === 0, violations };
}
