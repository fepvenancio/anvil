import type { Plan } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { executeTask, type WorkerResult } from '../workers/worker.js';
import { topologicalSort } from '../core/topological-sort.js';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';

export interface ExecutionResult {
  success: boolean;
  results: WorkerResult[];
  failedTasks: string[];
}

/**
 * Executes plan tasks sequentially in topological order.
 * Each task runs in its own git worktree with atomic commit and merge.
 * Stops on first failure. Signal handlers clean up worktrees on interrupt.
 */
export async function executeSequentially(
  plan: Plan,
  config: AnvilConfig,
  options?: { baseDir?: string },
): Promise<ExecutionResult> {
  const baseDir = options?.baseDir ?? process.cwd();
  const worktreeManager = new WorktreeManager(baseDir);
  await worktreeManager.pruneStale();

  const ordered = topologicalSort(plan.tasks);
  const results: WorkerResult[] = [];
  const failedTasks: string[] = [];

  // Signal handler cleanup
  const cleanup = async () => {
    console.log('\nCleaning up worktrees...');
    await worktreeManager.cleanupAll();
    process.exit(1);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    for (let i = 0; i < ordered.length; i++) {
      const task = ordered[i];
      console.log(chalk.blue(`[${i + 1}/${ordered.length}] Executing task: ${task.id}`));
      console.log(chalk.dim(`  ${task.description.slice(0, 100)}`));

      const { worktreePath } = await worktreeManager.create(task.id);

      try {
        const result = await executeTask(task, worktreePath, config);
        results.push(result);

        if (result.success) {
          await worktreeManager.commitAndMerge(
            task.id,
            `feat(anvil): ${task.description.slice(0, 72)}`,
            task.writes,
          );
          console.log(
            chalk.green(`  ✓ Task ${task.id} complete (${result.filesWritten.length} files)`),
          );
        } else {
          failedTasks.push(task.id);
          console.log(chalk.red(`  ✗ Task ${task.id} failed: ${result.error}`));
          break; // Stop on first failure
        }
      } finally {
        await worktreeManager.cleanup(task.id);
      }
    }
  } finally {
    // Remove signal handlers
    process.removeListener('SIGINT', cleanup);
    process.removeListener('SIGTERM', cleanup);
  }

  // Save plan to .anvil/roadmap.json
  await writeFile(
    join(baseDir, '.anvil', 'roadmap.json'),
    JSON.stringify(plan, null, 2),
  );

  return { success: failedTasks.length === 0, results, failedTasks };
}
