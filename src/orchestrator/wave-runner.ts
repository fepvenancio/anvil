import type { Plan } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';
import type { SubJudgeReport } from '../schemas/reports.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { executeTask, type WorkerResult } from '../workers/worker.js';
import { topologicalWaves } from '../core/topological-sort.js';
import { runSubJudges } from '../judges/sub-judge-panel.js';
import pLimit from 'p-limit';
import { simpleGit } from 'simple-git';
import type Anthropic from '@anthropic-ai/sdk';
import type { CostTracker } from '../cost/tracker.js';
import { ProgressDisplay } from '../ui/progress.js';

export interface WaveReport {
  waveNumber: number;
  taskResults: WorkerResult[];
  merged: string[];
  failed: string[];
}

export interface WaveExecutionResult {
  success: boolean;
  results: WorkerResult[];
  waveReports: WaveReport[];
  judgeReports: SubJudgeReport[];
  haltedAtWave?: number;
  failedTasks: string[];
}

/**
 * Executes plan tasks in parallel within waves, sequentially across waves.
 * Each wave groups independent tasks by BFS level in the dependency DAG.
 * After each wave, successful task branches are merged to main in deterministic order.
 * If any task fails in a wave, progression halts.
 */
export async function executeInWaves(
  plan: Plan,
  config: AnvilConfig,
  options?: { client?: Anthropic; baseDir?: string; costTracker?: CostTracker; progress?: ProgressDisplay },
): Promise<WaveExecutionResult> {
  const baseDir = options?.baseDir ?? process.cwd();
  const progress = options?.progress ?? new ProgressDisplay();
  const worktreeManager = new WorktreeManager(baseDir);
  await worktreeManager.pruneStale();

  const waves = topologicalWaves(plan.tasks);
  const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));
  const git = simpleGit(baseDir);
  const allResults: WorkerResult[] = [];
  const waveReports: WaveReport[] = [];
  const judgeReports: SubJudgeReport[] = [];
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
    for (const wave of waves) {
      progress.waveStart(wave.waveNumber, waves.length, wave.taskIds.length);

      const limit = pLimit(config.maxWorkers);
      const waveResults: WorkerResult[] = [];
      const waveTaskIds = wave.taskIds;

      // Execute all tasks in this wave in parallel (up to maxWorkers)
      await Promise.all(
        waveTaskIds.map((taskId) =>
          limit(async () => {
            const task = taskMap.get(taskId);
            if (!task) {
              waveResults.push({
                taskId,
                success: false,
                filesWritten: [],
                error: `Task ${taskId} not found in plan`,
              });
              return;
            }

            progress.taskStart(wave.waveNumber, taskId);

            let worktreePath: string | undefined;
            try {
              const wt = await worktreeManager.create(taskId);
              worktreePath = wt.worktreePath;

              const result = await executeTask(task, worktreePath, config, {
                client: options?.client,
              });
              waveResults.push(result);

              if (result.success) {
                // Record worker cost if tracker provided
                if (result.usage && options?.costTracker) {
                  options.costTracker.recordFromResponse(
                    {
                      usage: {
                        input_tokens: result.usage.input_tokens,
                        output_tokens: result.usage.output_tokens,
                        cache_creation_input_tokens: result.usage.cache_creation_input_tokens ?? undefined,
                        cache_read_input_tokens: result.usage.cache_read_input_tokens ?? undefined,
                      },
                    },
                    `worker:${taskId}`,
                    config.model,
                    wave.waveNumber,
                  );
                }
                await worktreeManager.commitInWorktree(
                  taskId,
                  `feat(anvil): ${task.description.slice(0, 72)}`,
                );
                progress.taskComplete(wave.waveNumber, taskId, result.filesWritten.length);
              } else {
                progress.taskFailed(wave.waveNumber, taskId, result.error ?? 'unknown');
              }
            } catch (err) {
              const error = err instanceof Error ? err.message : String(err);
              waveResults.push({
                taskId,
                success: false,
                filesWritten: [],
                error,
              });
              progress.taskFailed(wave.waveNumber, taskId, error);
            }
          }),
        ),
      );

      // Separate successes from failures
      const successTaskIds = waveResults
        .filter((r) => r.success)
        .map((r) => r.taskId);
      const failedInWave = waveResults
        .filter((r) => !r.success)
        .map((r) => r.taskId);

      // Capture baseline SHA before merges (for Sub-Judge touch-map diffing)
      // On empty repos (no commits yet), HEAD doesn't exist — use empty tree SHA
      let baselineSha: string;
      try {
        baselineSha = await git.revparse(['HEAD']);
      } catch {
        baselineSha = '4b825dc642cb6eb9a060e54bf899d69f82cf7202'; // git empty tree
      }

      // Batch merge successful task branches
      let mergeResult = { merged: [] as string[], failed: [] as string[] };
      if (successTaskIds.length > 0) {
        mergeResult = await worktreeManager.mergeWaveBranches(successTaskIds);
        if (mergeResult.failed.length > 0) {
          for (const failedId of mergeResult.failed) {
            progress.taskFailed(wave.waveNumber, failedId, 'merge failed');
          }
        }
      }

      // Cleanup ALL worktrees (success + failure)
      for (const taskId of waveTaskIds) {
        try {
          await worktreeManager.cleanup(taskId);
        } catch {
          // Best effort cleanup
        }
      }

      // Record wave report
      const report: WaveReport = {
        waveNumber: wave.waveNumber,
        taskResults: waveResults,
        merged: mergeResult.merged,
        failed: [...failedInWave, ...mergeResult.failed],
      };
      waveReports.push(report);
      allResults.push(...waveResults);
      failedTasks.push(...failedInWave, ...mergeResult.failed);

      // Run Sub-Judges after wave merge
      const waveTasks = waveTaskIds
        .map((id) => taskMap.get(id))
        .filter((t): t is NonNullable<typeof t> => t != null);
      const judgeReport = await runSubJudges(baseDir, wave.waveNumber, waveTasks, baselineSha);
      judgeReports.push(judgeReport);

      // Display judge results
      for (const check of judgeReport.checks) {
        progress.judgeResult(check);
      }

      // If any task failed OR Sub-Judge failed, halt progression
      const hasTaskFailures = failedInWave.length > 0 || mergeResult.failed.length > 0;
      const hasJudgeFailures = !judgeReport.allPassed;

      if (hasTaskFailures || hasJudgeFailures) {
        const reasons: string[] = [];
        if (hasTaskFailures) reasons.push('task failures');
        if (hasJudgeFailures) reasons.push('Sub-Judge failures');
        progress.waveHalted(wave.waveNumber, reasons);
        return {
          success: false,
          results: allResults,
          waveReports,
          judgeReports,
          haltedAtWave: wave.waveNumber,
          failedTasks,
        };
      }

      progress.waveComplete(wave.waveNumber, mergeResult.merged.length);
    }
  } finally {
    process.removeListener('SIGINT', cleanup);
    process.removeListener('SIGTERM', cleanup);
  }

  return {
    success: true,
    results: allResults,
    waveReports,
    judgeReports,
    failedTasks: [],
  };
}
