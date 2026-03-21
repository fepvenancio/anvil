import type { Plan } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';
import type { SubJudgeReport } from '../schemas/reports.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { executeTask, type WorkerResult } from '../workers/worker.js';
import { topologicalWaves } from '../core/topological-sort.js';
import { runSubJudges } from '../judges/sub-judge-panel.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import pLimit from 'p-limit';
import { simpleGit } from 'simple-git';
import type { CostTracker } from '../cost/tracker.js';
import { ProgressDisplay } from '../ui/progress.js';

const execFileAsync = promisify(execFile);

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
  options?: { baseDir?: string; costTracker?: CostTracker; progress?: ProgressDisplay; maxWaveRetries?: number },
): Promise<WaveExecutionResult> {
  const baseDir = options?.baseDir ?? process.cwd();
  const progress = options?.progress ?? new ProgressDisplay();
  const maxWaveRetries = options?.maxWaveRetries ?? 2;
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

              const abortController = new AbortController();
              const workerTimeout = setTimeout(() => abortController.abort(), config.workerTimeoutMs);
              let result: WorkerResult;
              try {
                result = await executeTask(task, worktreePath, config, { abortController });
              } finally {
                clearTimeout(workerTimeout);
              }
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
                  task.writes,
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

      // Post-merge: reconcile dependencies on main branch
      // Workers don't commit lockfiles (causes merge conflicts in parallel waves).
      // Instead, run npm install once on merged main to generate a consistent lockfile.
      try {
        await stat(join(baseDir, 'package.json'));
        await execFileAsync('npm', ['install', '--ignore-scripts'], {
          cwd: baseDir,
          timeout: 120_000,
        });
      } catch {
        // No package.json or install failed — skip silently
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
      let judgeReport = await runSubJudges(baseDir, wave.waveNumber, waveTasks, baselineSha);
      judgeReports.push(judgeReport);

      // Display judge results
      for (const check of judgeReport.checks) {
        progress.judgeResult(check);
      }

      // If any task failed OR Sub-Judge failed, attempt retries before halting
      let currentFailedInWave = [...failedInWave];
      let currentMergeResult = mergeResult;
      let hasTaskFailures = currentFailedInWave.length > 0 || currentMergeResult.failed.length > 0;
      let hasJudgeFailures = !judgeReport.allPassed;
      let retriesRemaining = maxWaveRetries;

      while ((hasTaskFailures || hasJudgeFailures) && retriesRemaining > 0) {
        const retryAttempt = maxWaveRetries - retriesRemaining + 1;
        progress.waveRetry(wave.waveNumber, retryAttempt, maxWaveRetries);

        // Collect error context for retry prompts
        const errorDetails: string[] = [];
        for (const r of waveResults.filter((r) => !r.success)) {
          errorDetails.push(`Task ${r.taskId} failed: ${r.error ?? 'unknown error'}`);
        }
        for (const mfId of currentMergeResult.failed) {
          errorDetails.push(`Task ${mfId} failed: merge conflict`);
        }
        if (hasJudgeFailures) {
          for (const check of judgeReport.checks.filter((c) => !c.passed)) {
            errorDetails.push(`Sub-Judge ${check.name} failed: ${check.message ?? 'FAILED'}`);
          }
        }
        const retryContext = errorDetails.join('\n');

        // Identify which task IDs need retry
        const taskIdsToRetry: string[] = [
          ...currentFailedInWave,
          ...currentMergeResult.failed,
        ];
        // If only judge failures (all tasks passed), retry all tasks in the wave
        if (taskIdsToRetry.length === 0 && hasJudgeFailures) {
          taskIdsToRetry.push(...waveTaskIds);
        }
        const uniqueRetryIds = [...new Set(taskIdsToRetry)];

        // Revert wave merges back to baseline
        await git.reset(['--hard', baselineSha]);

        // Remove previous results for tasks being retried
        for (const retryId of uniqueRetryIds) {
          const allIdx = allResults.findIndex((r) => r.taskId === retryId);
          if (allIdx !== -1) allResults.splice(allIdx, 1);
          const waveIdx = waveResults.findIndex((r) => r.taskId === retryId);
          if (waveIdx !== -1) waveResults.splice(waveIdx, 1);
          const ftIdx = failedTasks.indexOf(retryId);
          if (ftIdx !== -1) failedTasks.splice(ftIdx, 1);
        }

        // Re-execute failed tasks
        const retryLimit = pLimit(config.maxWorkers);
        const retryResults: WorkerResult[] = [];

        await Promise.all(
          uniqueRetryIds.map((taskId) =>
            retryLimit(async () => {
              const task = taskMap.get(taskId);
              if (!task) {
                retryResults.push({
                  taskId,
                  success: false,
                  filesWritten: [],
                  error: `Task ${taskId} not found in plan`,
                });
                return;
              }

              progress.taskStart(wave.waveNumber, taskId);

              let retryWorktreePath: string | undefined;
              try {
                const wt = await worktreeManager.create(taskId);
                retryWorktreePath = wt.worktreePath;

                const retryAbort = new AbortController();
                const retryTimeoutHandle = setTimeout(() => retryAbort.abort(), config.workerTimeoutMs);
                let retryResult: WorkerResult;
                try {
                  retryResult = await executeTask(task, retryWorktreePath, config, { retryContext, abortController: retryAbort });
                } finally {
                  clearTimeout(retryTimeoutHandle);
                }
                retryResults.push(retryResult);

                if (retryResult.success) {
                  if (retryResult.usage && options?.costTracker) {
                    options.costTracker.recordFromResponse(
                      {
                        usage: {
                          input_tokens: retryResult.usage.input_tokens,
                          output_tokens: retryResult.usage.output_tokens,
                          cache_creation_input_tokens: retryResult.usage.cache_creation_input_tokens ?? undefined,
                          cache_read_input_tokens: retryResult.usage.cache_read_input_tokens ?? undefined,
                        },
                      },
                      `worker:${taskId}:retry${retryAttempt}`,
                      config.model,
                      wave.waveNumber,
                    );
                  }
                  await worktreeManager.commitInWorktree(
                    taskId,
                    `feat(anvil): ${task.description.slice(0, 72)} (retry ${retryAttempt})`,
                    task.writes,
                  );
                  progress.taskComplete(wave.waveNumber, taskId, retryResult.filesWritten.length);
                } else {
                  progress.taskFailed(wave.waveNumber, taskId, retryResult.error ?? 'unknown');
                }
              } catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                retryResults.push({
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

        // Separate retry successes from failures
        const retrySuccessIds = retryResults
          .filter((r) => r.success)
          .map((r) => r.taskId);
        const retryFailedIds = retryResults
          .filter((r) => !r.success)
          .map((r) => r.taskId);

        // Re-merge: originally successful tasks (not retried) + newly successful retries
        const originalSuccessIds = waveResults
          .filter((r) => r.success)
          .map((r) => r.taskId);
        const allSuccessIds = [...originalSuccessIds, ...retrySuccessIds];

        currentMergeResult = { merged: [] as string[], failed: [] as string[] };
        if (allSuccessIds.length > 0) {
          currentMergeResult = await worktreeManager.mergeWaveBranches(allSuccessIds);
          if (currentMergeResult.failed.length > 0) {
            for (const failedId of currentMergeResult.failed) {
              progress.taskFailed(wave.waveNumber, failedId, 'merge failed');
            }
          }
        }

        // Cleanup retry worktrees
        for (const taskId of uniqueRetryIds) {
          try {
            await worktreeManager.cleanup(taskId);
          } catch {
            // Best effort cleanup
          }
        }

        // Update tracking
        currentFailedInWave = [...retryFailedIds];
        waveResults.push(...retryResults);
        allResults.push(...retryResults);
        failedTasks.push(...retryFailedIds, ...currentMergeResult.failed);

        // Update wave report
        const existingReportIdx = waveReports.findIndex((r) => r.waveNumber === wave.waveNumber);
        const updatedReport: WaveReport = {
          waveNumber: wave.waveNumber,
          taskResults: waveResults,
          merged: currentMergeResult.merged,
          failed: [...retryFailedIds, ...currentMergeResult.failed],
        };
        if (existingReportIdx !== -1) {
          waveReports[existingReportIdx] = updatedReport;
        }

        // Re-run Sub-Judges after retry merges
        judgeReport = await runSubJudges(baseDir, wave.waveNumber, waveTasks, baselineSha);
        judgeReports.push(judgeReport);

        for (const check of judgeReport.checks) {
          progress.judgeResult(check);
        }

        hasTaskFailures = retryFailedIds.length > 0 || currentMergeResult.failed.length > 0;
        hasJudgeFailures = !judgeReport.allPassed;
        retriesRemaining--;
      }

      // If still failing after all retries, halt
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

      progress.waveComplete(wave.waveNumber, currentMergeResult.merged.length);
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
