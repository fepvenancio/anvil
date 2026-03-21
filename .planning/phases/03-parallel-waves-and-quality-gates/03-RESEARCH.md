# Phase 3: Parallel Waves and Quality Gates - Research

**Researched:** 2026-03-21
**Domain:** Concurrent task execution, git worktree merge orchestration, mechanical code quality checks
**Confidence:** HIGH

## Summary

Phase 3 upgrades Anvil from sequential task execution to parallel wave-based execution with mechanical quality gates. The existing `sequential-runner.ts` processes tasks one at a time with immediate per-task merge; this must become a wave runner that (1) groups tasks into waves via the existing topological sort, (2) runs independent tasks within a wave concurrently using `p-limit`, (3) merges all wave branches to main after the wave completes, and (4) runs Sub-Judge mechanical checks before allowing the next wave to start.

The existing infrastructure is well-suited for this upgrade. `topological-sort.ts` already implements Kahn's algorithm and can be extended to return wave groupings (tasks with the same "level" in the DAG). `WorktreeManager` already handles create/commit/merge/cleanup per task. The `SubJudgeReport` schema already exists. The main work is: a new `wave-runner.ts` that replaces the sequential loop, a `sub-judge-panel.ts` that runs tsc/vitest/touch-map checks, and modifications to the merge flow to batch merges per wave instead of per task.

**Primary recommendation:** Build the wave runner as a new module (`src/orchestrator/wave-runner.ts`) that imports and composes existing modules. Keep `sequential-runner.ts` intact as a fallback. Add `p-limit` for concurrency control. Implement Sub-Judges as simple child process spawners (`node:child_process.execFile`) for tsc and vitest, plus the existing `validateTouchMap` for touch-map checks.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXEC-04 | Orchestrator performs topological sort on dependency graph to produce ordered waves | Extend existing `topologicalSort()` in `src/core/topological-sort.ts` to return `Wave[]` (group by BFS level). Wave schema already exists in `src/schemas/wave.ts`. |
| EXEC-05 | Independent tasks within a wave execute in parallel (default 4 workers, configurable) | Use `p-limit` for concurrency control. `config.maxWorkers` already exists in `AnvilConfig`. Wire `p-limit(config.maxWorkers)` in wave runner. |
| EXEC-06 | After each wave completes, all worktrees are merged to main branch | Refactor current per-task `commitAndMerge` in `WorktreeManager` into a batch merge method. Merge all wave branches sequentially in deterministic task-ID order after all tasks finish. |
| EXEC-07 | Worktrees are cleaned up after merge (no stale worktrees left behind) | `WorktreeManager.cleanup()` and `cleanupAll()` already exist. Call cleanup per task after merge. Add signal handlers for wave-level cleanup. |
| EXEC-08 | Workers that fail halt their task; the wave continues but the failed task is reported | Use `Promise.allSettled` semantics via p-limit. Catch per-task errors, record them, but let other tasks complete. Failed tasks are excluded from merge. |
| REVW-01 | Sub-Judges run in parallel after every wave with mechanical checks | New `SubJudgePanel` module runs checks concurrently via `Promise.all`. Each check spawns a child process or calls existing validators. |
| REVW-01a | Minimal v1 Sub-Judge set: tsc check, touch-map violation detector, vitest run (if tests exist) | Three judges: (1) `tsc --noEmit` via `execFile`, (2) git diff + touch-map validation on merged main, (3) `npx vitest run` if test files exist. All deterministic, no AI. |
| REVW-02 | Sub-Judge failure halts progression to next wave; all failures reported together | Wave runner checks `SubJudgeReport.allPassed` before proceeding to next wave. If false, collect all check results, write report to `.anvil/reports/`, return failure. |
</phase_requirements>

## Standard Stack

### Core (already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| simple-git | ^3.33.0 | Git worktree, merge, branch operations | Already used in WorktreeManager. Sufficient for all merge operations. |
| zod | ^4.3.6 | SubJudgeReport validation | SubJudgeReportSchema already defined. |
| chalk | ^5.6.2 | Terminal output for wave/judge status | Already used in sequential-runner. |

### New Dependencies

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| p-limit | ^7.3.0 | Concurrency control for parallel task execution within waves | Wrap `executeTask()` calls in wave runner. NOTE: npm shows v7.3.0 as current, not 6.2.0 as originally recommended. Use ^7.3.0. |

### Built-in (no install needed)

| Module | Purpose |
|--------|---------|
| `node:child_process` (`execFile`) | Spawn `tsc` and `vitest` for Sub-Judge checks |
| `node:fs/promises` (`stat`, `access`) | Check if test files exist before running vitest judge |
| `node:path` | Path manipulation for worktree and report paths |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| p-limit | p-queue | p-queue adds priority/pause features we don't need. p-limit is simpler and sufficient for "run N at a time, wait for all". |
| execFile for tsc/vitest | execa | execa adds a dependency. `node:child_process.execFile` with promisify is sufficient for spawning known binaries. |

**Installation:**
```bash
npm install p-limit@^7.3.0
```

## Architecture Patterns

### Recommended Project Structure (new/modified files)
```
src/
  orchestrator/
    sequential-runner.ts    # KEEP (fallback, no changes)
    wave-runner.ts          # NEW: parallel wave execution loop
  core/
    topological-sort.ts     # MODIFY: add topologicalWaves() function
  judges/
    sub-judge-panel.ts      # NEW: orchestrates Sub-Judge checks
    tsc-judge.ts            # NEW: runs tsc --noEmit
    vitest-judge.ts         # NEW: runs vitest run (if tests exist)
    touch-map-judge.ts      # NEW: validates merged diff against touch maps
  git/
    worktree-manager.ts     # MODIFY: add batch merge method
tests/
  unit/
    topological-waves.test.ts   # NEW
    sub-judge-panel.test.ts     # NEW
  integration/
    wave-runner.test.ts         # NEW
```

### Pattern 1: Wave Grouping via BFS Levels

**What:** Extend the existing Kahn's algorithm to group tasks by their BFS level. All tasks at the same level have their dependencies satisfied by earlier levels, so they can run in parallel.

**When to use:** After plan validation, before execution.

**Example:**
```typescript
// In src/core/topological-sort.ts
import type { Task } from '../schemas/plan.js';
import type { Wave } from '../schemas/wave.ts';

export function topologicalWaves(tasks: Task[]): Wave[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const inDegree = new Map(tasks.map(t => [t.id, 0]));
  const adjList = new Map<string, string[]>();

  for (const task of tasks) {
    adjList.set(task.id, []);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      adjList.get(dep)?.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  const waves: Wave[] = [];
  let queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  let waveNumber = 1;
  while (queue.length > 0) {
    waves.push({
      waveNumber,
      taskIds: [...queue],
      status: 'pending',
    });

    const nextQueue: string[] = [];
    for (const id of queue) {
      for (const neighbor of adjList.get(id) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) nextQueue.push(neighbor);
      }
    }
    queue = nextQueue;
    waveNumber++;
  }

  // Cycle detection: check all tasks scheduled
  const scheduled = new Set(waves.flatMap(w => w.taskIds));
  if (scheduled.size !== tasks.length) {
    const remaining = tasks.filter(t => !scheduled.has(t.id)).map(t => t.id);
    throw new Error(`Dependency cycle detected among tasks: ${remaining.join(', ')}`);
  }

  return waves;
}
```

### Pattern 2: Wave Runner with p-limit and Error Isolation

**What:** Execute all tasks in a wave concurrently (up to maxWorkers), collecting results via allSettled semantics. Failed tasks are recorded but do not crash the wave.

**When to use:** Main execution loop.

**Example:**
```typescript
// In src/orchestrator/wave-runner.ts
import pLimit from 'p-limit';

async function executeWave(
  wave: Wave,
  tasks: Task[],
  config: AnvilConfig,
  worktreeManager: WorktreeManager,
  options?: { client?: Anthropic },
): Promise<WaveResult> {
  const limit = pLimit(config.maxWorkers);
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  const promises = wave.taskIds.map(taskId => {
    const task = taskMap.get(taskId)!;
    return limit(async () => {
      const { worktreePath } = await worktreeManager.create(task.id);
      try {
        const result = await executeTask(task, worktreePath, config, options);
        return { taskId, result, worktreePath };
      } catch (error) {
        return {
          taskId,
          result: {
            taskId: task.id,
            success: false,
            filesWritten: [],
            error: error instanceof Error ? error.message : String(error),
          },
          worktreePath,
        };
      }
    });
  });

  const outcomes = await Promise.all(promises);
  // ... process outcomes, merge successes, report failures
}
```

### Pattern 3: Sub-Judge as Child Process Spawner

**What:** Each Sub-Judge spawns a deterministic external tool and interprets its exit code + output.

**When to use:** After wave merge, before next wave.

**Example:**
```typescript
// In src/judges/tsc-judge.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SubJudgeCheck } from '../schemas/reports.js';

const execFileAsync = promisify(execFile);

export async function runTscCheck(projectDir: string): Promise<SubJudgeCheck> {
  try {
    await execFileAsync('npx', ['tsc', '--noEmit'], {
      cwd: projectDir,
      timeout: 60_000,
    });
    return { name: 'tsc', passed: true };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string };
    return {
      name: 'tsc',
      passed: false,
      message: 'TypeScript compilation failed',
      details: (err.stdout ?? '') + (err.stderr ?? ''),
    };
  }
}
```

### Pattern 4: Batch Merge After Wave Completion

**What:** After all tasks in a wave complete, merge successful task branches to main in deterministic order (sorted by task ID). Failed tasks are not merged -- their worktrees are cleaned up.

**When to use:** Between wave execution and Sub-Judge checks.

**Key detail:** The current `WorktreeManager.commitAndMerge()` does commit + merge in one call. For wave execution, split this: Workers commit in their worktrees during execution, then a separate merge pass handles all branches after the wave. This prevents partial merges if a later task fails.

```typescript
// New method on WorktreeManager
async mergeWaveBranches(taskIds: string[]): Promise<{ merged: string[]; failed: string[] }> {
  const merged: string[] = [];
  const failed: string[] = [];

  // Sort for deterministic merge order
  const sorted = [...taskIds].sort();

  for (const taskId of sorted) {
    const info = this.activeWorktrees.get(taskId);
    if (!info) continue;

    try {
      // Commit any staged changes in the worktree
      const worktreeGit = simpleGit(info.worktreePath);
      await worktreeGit.add('.');
      const status = await worktreeGit.status();
      if (status.staged.length > 0) {
        await worktreeGit.commit(`feat(anvil): ${taskId}`);
      }
      // Merge branch into main
      await this.git.merge([info.branch, '--no-ff']);
      merged.push(taskId);
    } catch (err) {
      failed.push(taskId);
      // Abort merge if in conflict state
      try { await this.git.merge(['--abort']); } catch { /* not in merge */ }
    }
  }

  return { merged, failed };
}
```

### Anti-Patterns to Avoid

- **Merging as tasks complete (eager merge):** Do NOT merge each task branch as soon as the worker finishes. Wait for ALL tasks in the wave to complete, then merge. This prevents partial merges and ensures Sub-Judges check the fully-merged state.
- **Using AI for Sub-Judges:** Sub-Judges MUST be deterministic (tsc, vitest, git diff). No LLM calls. This is a core Forge principle.
- **Sharing state between parallel workers:** Workers are isolated in worktrees. No shared mutable state. The orchestrator collects results after all workers finish.
- **Killing the wave on first task failure:** A failed task should NOT abort other running tasks. Use error isolation -- let all tasks finish, then report failures together.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrency limiting | Custom semaphore/queue | `p-limit` | Edge cases (cancellation, error propagation, cleanup) are tricky. p-limit handles them. |
| TypeScript compilation check | Custom AST parsing | `tsc --noEmit` via child process | tsc is the authoritative checker. Any reimplementation will miss edge cases. |
| Test execution | Custom test discovery/runner | `npx vitest run` via child process | vitest handles config, TypeScript, timeouts, etc. |
| Git merge conflict detection | Custom diff comparison | `simple-git.merge()` with error catching | Git handles merge algorithms correctly. Catch merge failures, don't predict them. |

**Key insight:** Sub-Judges are thin wrappers around existing tools. The value is in the orchestration (running them at the right time, collecting results, gating progression), not in reimplementing what tsc/vitest already do.

## Common Pitfalls

### Pitfall 1: Merge Conflicts Between Same-Wave Tasks
**What goes wrong:** Two tasks in the same wave modify different files, but git merge still fails because they both changed package.json, or auto-generated files like lockfiles.
**Why it happens:** The Planner's overlap detection checks `writes[]` arrays, but generated code may create files not declared in writes (e.g., lockfiles after `npm install`).
**How to avoid:** (1) Touch-map validation already catches undeclared file writes. (2) Merge in sorted order so conflicts are reproducible. (3) If merge fails, record the failure in the wave report and exclude that task. (4) The Planner should prevent same-wave tasks from both writing to package.json.
**Warning signs:** Merge failures with "CONFLICT" in the error output despite no declared write overlaps.

### Pitfall 2: Worktree Cleanup on Partial Wave Failure
**What goes wrong:** If 2 of 4 tasks succeed and 2 fail, the wave runner must merge the successful tasks AND clean up all 4 worktrees. If cleanup is skipped for failed tasks, stale worktrees accumulate.
**Why it happens:** Error handling paths miss cleanup for tasks that errored before creating worktrees, or for tasks that errored after creating worktrees but before committing.
**How to avoid:** Always use try/finally for worktree cleanup. Track worktree creation status separately from task success. Clean up ALL worktrees after merge, regardless of task outcome.
**Warning signs:** `git worktree list` shows entries from previous runs.

### Pitfall 3: Sub-Judge Running Against Stale State
**What goes wrong:** Sub-Judges check the project directory, but if merges haven't completed or if the working directory has uncommitted changes, the checks run against wrong state.
**Why it happens:** Race between merge completion and Sub-Judge start.
**How to avoid:** Sub-Judges run strictly AFTER all merges complete and AFTER the main branch checkout is clean. Verify with `git status` before running judges.
**Warning signs:** tsc passes in Sub-Judge but fails when user runs it manually.

### Pitfall 4: Vitest Sub-Judge Hanging on Interactive Mode
**What goes wrong:** `vitest` without the `run` flag enters watch mode, hanging the pipeline indefinitely.
**Why it happens:** Default vitest behavior is watch mode when stdin is a TTY.
**How to avoid:** Always use `vitest run` (not just `vitest`). Set `timeout` on the child process (60s). Set `stdio: 'pipe'` to detach from TTY.
**Warning signs:** Build hangs after wave merge with no output.

### Pitfall 5: p-limit Error Propagation
**What goes wrong:** If a task throws an unhandled exception inside p-limit, it can reject the overall Promise and skip remaining tasks.
**Why it happens:** p-limit wraps functions but does not catch errors -- the caller must handle them.
**How to avoid:** Wrap each task execution in a try/catch inside the p-limit callback. Never let raw rejections propagate.
**Warning signs:** Wave stops after first task error despite the design calling for continued execution.

## Code Examples

### Wave Runner Main Loop
```typescript
// Verified pattern based on existing codebase analysis
export async function executeInWaves(
  plan: Plan,
  config: AnvilConfig,
  options?: { client?: Anthropic; baseDir?: string },
): Promise<WaveExecutionResult> {
  const baseDir = options?.baseDir ?? process.cwd();
  const worktreeManager = new WorktreeManager(baseDir);
  await worktreeManager.pruneStale();

  const waves = topologicalWaves(plan.tasks);
  const taskMap = new Map(plan.tasks.map(t => [t.id, t]));
  const allResults: WorkerResult[] = [];
  const waveReports: SubJudgeReport[] = [];

  for (const wave of waves) {
    console.log(chalk.blue(`\n=== Wave ${wave.waveNumber} (${wave.taskIds.length} tasks) ===\n`));

    // Execute tasks in parallel with concurrency limit
    const limit = pLimit(config.maxWorkers);
    const waveResults = await Promise.all(
      wave.taskIds.map(taskId => limit(async () => {
        const task = taskMap.get(taskId)!;
        const { worktreePath } = await worktreeManager.create(task.id);
        try {
          return await executeTask(task, worktreePath, config, options);
        } catch (error) {
          return {
            taskId: task.id,
            success: false,
            filesWritten: [] as string[],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      })),
    );

    allResults.push(...waveResults);
    const successes = waveResults.filter(r => r.success).map(r => r.taskId);
    const failures = waveResults.filter(r => !r.success).map(r => r.taskId);

    // Merge successful tasks
    const mergeResult = await worktreeManager.mergeWaveBranches(successes);

    // Cleanup ALL worktrees (success and failure)
    for (const taskId of wave.taskIds) {
      await worktreeManager.cleanup(taskId);
    }

    // Run Sub-Judges on merged state
    const judgeReport = await runSubJudges(baseDir, wave.waveNumber, plan.tasks);
    waveReports.push(judgeReport);

    // Gate: halt if Sub-Judges failed
    if (!judgeReport.allPassed) {
      return { success: false, results: allResults, waveReports, haltedAtWave: wave.waveNumber };
    }

    // Gate: halt if any task failed (report but don't crash)
    if (failures.length > 0) {
      return { success: false, results: allResults, waveReports, haltedAtWave: wave.waveNumber };
    }
  }

  return { success: true, results: allResults, waveReports };
}
```

### Sub-Judge Panel
```typescript
// In src/judges/sub-judge-panel.ts
import type { SubJudgeReport, SubJudgeCheck } from '../schemas/reports.js';
import { runTscCheck } from './tsc-judge.js';
import { runVitestCheck } from './vitest-judge.js';
import { runTouchMapCheck } from './touch-map-judge.js';
import type { Task } from '../schemas/plan.js';

export async function runSubJudges(
  projectDir: string,
  waveNumber: number,
  tasks: Task[],
): Promise<SubJudgeReport> {
  const checks: SubJudgeCheck[] = await Promise.all([
    runTscCheck(projectDir),
    runVitestCheck(projectDir),
    runTouchMapCheck(projectDir, waveNumber, tasks),
  ]);

  return {
    waveNumber,
    checks,
    allPassed: checks.every(c => c.passed),
    timestamp: new Date().toISOString(),
  };
}
```

### Touch-Map Judge (Post-Merge)
```typescript
// In src/judges/touch-map-judge.ts
// Verify that the merged diff only contains files declared in task writes[]
import { simpleGit } from 'simple-git';
import type { SubJudgeCheck } from '../schemas/reports.js';
import type { Task } from '../schemas/plan.js';

export async function runTouchMapCheck(
  projectDir: string,
  waveNumber: number,
  tasks: Task[],
): Promise<SubJudgeCheck> {
  const git = simpleGit(projectDir);

  // Get files changed in the last wave's merges
  // Compare HEAD against the state before wave merges
  // Use git log to find merge commits for this wave
  const allowedWrites = new Set(tasks.flatMap(t => t.writes));

  const diff = await git.diff(['--name-only', `HEAD~${tasks.length}`, 'HEAD']);
  const changedFiles = diff.split('\n').filter(f => f.length > 0);
  const violations = changedFiles.filter(f => !allowedWrites.has(f));

  if (violations.length === 0) {
    return { name: 'touch-map', passed: true };
  }

  return {
    name: 'touch-map',
    passed: false,
    message: `${violations.length} file(s) modified outside declared writes[]`,
    details: violations.join('\n'),
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential task execution | Wave-based parallel execution | Phase 3 | 2-4x speedup for plans with parallelizable tasks |
| Per-task merge immediately | Batch merge after wave | Phase 3 | Ensures consistent state for Sub-Judge checks |
| No quality gates | Mechanical Sub-Judges after each wave | Phase 3 | Catch errors before they cascade to later waves |

**p-limit version note:** The STACK.md recommends `p-limit ^6.2.0` but npm shows v7.3.0 as current. p-limit v7 is ESM-only (same as v6), API is identical (`pLimit(concurrency)` returns a `limit` function). Use ^7.3.0 for latest fixes.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.0 |
| Config file | `/Users/address0/Documents/Repos/anvil/vitest.config.ts` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXEC-04 | Topological sort produces ordered waves | unit | `npx vitest run tests/unit/topological-waves.test.ts -x` | Wave 0 |
| EXEC-05 | Independent tasks run in parallel up to maxWorkers | integration | `npx vitest run tests/integration/wave-runner.test.ts -x` | Wave 0 |
| EXEC-06 | All worktrees merged to main after wave | integration | `npx vitest run tests/integration/wave-runner.test.ts -x` | Wave 0 |
| EXEC-07 | Worktrees cleaned up after merge | integration | `npx vitest run tests/integration/wave-runner.test.ts -x` | Wave 0 |
| EXEC-08 | Failed worker does not crash wave | unit | `npx vitest run tests/unit/wave-error-handling.test.ts -x` | Wave 0 |
| REVW-01 | Sub-Judges run after every wave | unit | `npx vitest run tests/unit/sub-judge-panel.test.ts -x` | Wave 0 |
| REVW-01a | tsc + touch-map + vitest judges | unit | `npx vitest run tests/unit/sub-judge-panel.test.ts -x` | Wave 0 |
| REVW-02 | Sub-Judge failure halts next wave | integration | `npx vitest run tests/integration/wave-runner.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/topological-waves.test.ts` -- covers EXEC-04 (wave grouping from DAG)
- [ ] `tests/unit/sub-judge-panel.test.ts` -- covers REVW-01, REVW-01a (judge orchestration and individual judges)
- [ ] `tests/unit/wave-error-handling.test.ts` -- covers EXEC-08 (failed tasks don't crash wave)
- [ ] `tests/integration/wave-runner.test.ts` -- covers EXEC-05, EXEC-06, EXEC-07, REVW-02 (full wave lifecycle with real git)

## Open Questions

1. **Touch-map judge: how to determine pre-wave commit for diff?**
   - What we know: After merging N branches, we need to diff against the state before merges started.
   - What's unclear: Should we tag the pre-wave commit, or track the commit SHA before merging?
   - Recommendation: Save the HEAD SHA before starting wave merges. Pass it to the touch-map judge as the baseline for diffing.

2. **Should failed tasks be retried before halting the wave?**
   - What we know: EXEC-08 says "failed Worker task is reported but does not crash the wave". REQUIREMENTS.md does not mention retry for v1.
   - What's unclear: Whether to add a retry budget (Phase 2 decision was fail-fast for sequential).
   - Recommendation: No retry in Phase 3. Failed tasks are reported. Retry logic belongs in a later phase if needed.

3. **Where to run tsc --noEmit: on Anvil's own project or the target project?**
   - What we know: Sub-Judges check the code Anvil generates, not Anvil's own code.
   - What's unclear: The target project may not have a tsconfig.json.
   - Recommendation: Run `tsc --noEmit` only if `tsconfig.json` exists in the target project root. Skip the check (pass with a note) if no tsconfig found. Same pattern for vitest: only run if test files exist.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/orchestrator/sequential-runner.ts`, `src/core/topological-sort.ts`, `src/git/worktree-manager.ts`, `src/workers/worker.ts`, `src/schemas/reports.ts`, `src/schemas/wave.ts`
- npm registry: p-limit v7.3.0 (verified 2026-03-21)
- Project docs: `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`

### Secondary (MEDIUM confidence)
- Architecture patterns from `.planning/research/ARCHITECTURE.md` -- wave execution flow, Sub-Judge panel design
- Pitfall analysis from `.planning/research/PITFALLS.md` -- worktree lifecycle, error cascading, merge order sensitivity

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in project or well-documented in STACK.md, p-limit version verified
- Architecture: HIGH - extending existing proven patterns (topo sort, worktree manager), not building from scratch
- Pitfalls: HIGH - well-documented in project's own PITFALLS.md research, directly applicable to this phase

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable domain, no fast-moving dependencies)
