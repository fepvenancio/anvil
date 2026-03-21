---
phase: 03-parallel-waves-and-quality-gates
verified: 2026-03-21T02:20:00Z
status: passed
score: 13/13 must-haves verified
re_verification: false
---

# Phase 3: Parallel Waves and Quality Gates — Verification Report

**Phase Goal:** Independent tasks execute in parallel within waves, merged between waves, with mechanical Sub-Judge checks gating progression
**Verified:** 2026-03-21T02:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                              | Status     | Evidence                                                                                          |
|----|----------------------------------------------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------------|
| 1  | Tasks are grouped into waves by BFS level in the dependency DAG                                   | VERIFIED   | `topologicalWaves()` in `src/core/topological-sort.ts` — full Kahn-BFS implementation, 7 tests   |
| 2  | Independent tasks within a wave run in parallel up to maxWorkers concurrency                      | VERIFIED   | `pLimit(config.maxWorkers)` in `wave-runner.ts:69`; `Promise.all` over all wave tasks             |
| 3  | After a wave completes, successful task branches are merged to main in deterministic order         | VERIFIED   | `worktreeManager.mergeWaveBranches(successTaskIds)` in `wave-runner.ts:147`, sorted by taskId     |
| 4  | All worktrees are cleaned up after wave merge (no stale worktrees)                                | VERIFIED   | `worktreeManager.cleanup(taskId)` for all tasks in `wave-runner.ts:158-164`; test at line 129     |
| 5  | A failed task does not crash other tasks in the wave; it is recorded and excluded from merge      | VERIFIED   | try/catch per task in `wave-runner.ts:91-128`; 4 unit tests + 2 integration tests confirm         |
| 6  | Sub-Judges run in parallel after every wave with mechanical checks                                | VERIFIED   | `runSubJudges` via `Promise.all` of 3 judges in `sub-judge-panel.ts:15-19`                       |
| 7  | v1 Sub-Judge set includes tsc check, touch-map violation detector, and vitest run                 | VERIFIED   | `tsc-judge.ts`, `vitest-judge.ts`, `touch-map-judge.ts` all exist and substantive                 |
| 8  | Sub-Judge failure reported with details but halts progression to next wave                        | VERIFIED   | `wave-runner.ts:197-217`: `!judgeReport.allPassed` halts with `haltedAtWave`; test at line 245    |
| 9  | All Sub-Judge results collected into SubJudgeReport with allPassed boolean                        | VERIFIED   | `sub-judge-panel.ts:21-26`; validated against `SubJudgeReportSchema` in test at line 282          |
| 10 | CLI `anvil run` uses wave execution by default (not sequential)                                   | VERIFIED   | `cli.ts:76`: `executeInWaves(reviewedPlan, config)` is the default path                           |
| 11 | The --sequential flag falls back to the original sequential runner                                | VERIFIED   | `cli.ts:28,64-66`: `--sequential` option routes to `executeSequentially`                          |
| 12 | Sub-Judge failure halts progression; all failures reported together                               | VERIFIED   | Both task failures and judge failures independently halt; combined in `reasons` array              |
| 13 | Wave execution results including judge reports are displayed in terminal                           | VERIFIED   | Chalk-colored output per check (`wave-runner.ts:185-194`); CLI prints judge failures at exit       |

**Score:** 13/13 truths verified

---

## Required Artifacts

### Plan 03-01 Artifacts

| Artifact                                     | Expected                                        | Status     | Details                                                              |
|----------------------------------------------|-------------------------------------------------|------------|----------------------------------------------------------------------|
| `src/core/topological-sort.ts`               | `topologicalWaves()` BFS-level grouping         | VERIFIED   | Exported at line 79; 57-line substantive BFS implementation          |
| `src/orchestrator/wave-runner.ts`            | `executeInWaves()` parallel wave execution loop | VERIFIED   | Exported at line 35; 237 lines, fully wired to topologicalWaves, p-limit, mergeWaveBranches, runSubJudges |
| `src/git/worktree-manager.ts`                | `mergeWaveBranches()` and `commitInWorktree()`  | VERIFIED   | Both methods present at lines 48 and 69; existing `commitAndMerge` preserved |
| `tests/unit/topological-waves.test.ts`       | Unit tests for wave grouping                    | VERIFIED   | 7 test cases: linear chain, independent tasks, single, cycle, empty, diamond, status |
| `tests/unit/wave-error-handling.test.ts`     | Unit tests for error isolation                  | VERIFIED   | 4 test cases: 1-of-3 failure, exclusion from merge, error capture, combined reporting |
| `tests/integration/wave-runner.test.ts`      | Integration tests with real git                 | VERIFIED   | 9 tests using real git repos and mocked Anthropic/Sub-Judge clients   |

### Plan 03-02 Artifacts

| Artifact                                | Expected                                               | Status     | Details                                                     |
|-----------------------------------------|--------------------------------------------------------|------------|-------------------------------------------------------------|
| `src/judges/sub-judge-panel.ts`         | `runSubJudges()` parallel orchestrator                 | VERIFIED   | Exported at line 9; Promise.all of 3 judges; saves report   |
| `src/judges/tsc-judge.ts`               | `runTscCheck()` spawns tsc --noEmit                    | VERIFIED   | Exported at line 9; skips if no tsconfig.json; 60s timeout  |
| `src/judges/vitest-judge.ts`            | `runVitestCheck()` spawns vitest run if tests exist    | VERIFIED   | Exported at line 25; find-based test file detection; 120s timeout |
| `src/judges/touch-map-judge.ts`         | `runTouchMapCheck()` validates merged diff vs writes[] | VERIFIED   | Exported at line 5; uses `baselineSha..HEAD` git diff       |
| `tests/unit/sub-judge-panel.test.ts`    | Tests for panel and individual judges                  | VERIFIED   | 14 tests: tsc (3), vitest (3), touch-map (3), panel (5)     |

### Plan 03-03 Artifacts

| Artifact                                | Expected                                              | Status     | Details                                                          |
|-----------------------------------------|-------------------------------------------------------|------------|------------------------------------------------------------------|
| `src/orchestrator/wave-runner.ts`       | Wave runner with Sub-Judge integration                | VERIFIED   | `runSubJudges` called after each wave merge at line 181          |
| `src/cli.ts`                            | CLI wired to wave runner with --sequential fallback   | VERIFIED   | `executeInWaves` default, `--sequential` flag present at line 28 |

---

## Key Link Verification

### Plan 03-01 Key Links

| From                           | To                              | Via                              | Status  | Details                                               |
|--------------------------------|---------------------------------|----------------------------------|---------|-------------------------------------------------------|
| `src/orchestrator/wave-runner.ts` | `src/core/topological-sort.ts` | `import topologicalWaves`       | WIRED   | Line 6 import; line 44 `topologicalWaves(plan.tasks)` |
| `src/orchestrator/wave-runner.ts` | `src/git/worktree-manager.ts`  | `mergeWaveBranches` batch merge  | WIRED   | Line 4 import; line 147 `mergeWaveBranches(successTaskIds)` |
| `src/orchestrator/wave-runner.ts` | `src/workers/worker.ts`        | `executeTask` within p-limit     | WIRED   | Line 5 import; line 95 `executeTask(task, worktreePath, config, ...)` inside `limit(async () => {...})` |

### Plan 03-02 Key Links

| From                            | To                               | Via                     | Status  | Details                                               |
|---------------------------------|----------------------------------|-------------------------|---------|-------------------------------------------------------|
| `src/judges/sub-judge-panel.ts` | `src/judges/tsc-judge.ts`        | `import runTscCheck`    | WIRED   | Line 5 import; line 16 `runTscCheck(projectDir)` in Promise.all |
| `src/judges/sub-judge-panel.ts` | `src/judges/vitest-judge.ts`     | `import runVitestCheck` | WIRED   | Line 6 import; line 17 `runVitestCheck(projectDir)` in Promise.all |
| `src/judges/sub-judge-panel.ts` | `src/judges/touch-map-judge.ts`  | `import runTouchMapCheck` | WIRED | Line 7 import; line 18 `runTouchMapCheck(projectDir, baselineSha, tasks)` |
| `src/judges/sub-judge-panel.ts` | `src/schemas/reports.ts`         | returns SubJudgeReport  | WIRED   | Lines 3-4 import; line 21 constructs and returns `SubJudgeReport` |

### Plan 03-03 Key Links

| From           | To                                  | Via                                      | Status  | Details                                                          |
|----------------|-------------------------------------|------------------------------------------|---------|------------------------------------------------------------------|
| `src/cli.ts`   | `src/orchestrator/wave-runner.ts`   | `import executeInWaves`                  | WIRED   | Line 11 import; line 76 `executeInWaves(reviewedPlan, config)` default path |
| `src/orchestrator/wave-runner.ts` | `src/judges/sub-judge-panel.ts` | `import runSubJudges`           | WIRED   | Line 7 import; line 181 `runSubJudges(baseDir, wave.waveNumber, waveTasks, baselineSha)` |
| `src/cli.ts`   | `src/orchestrator/sequential-runner.ts` | `import executeSequentially (fallback)` | WIRED | Line 10 import; line 66 `executeSequentially(reviewedPlan, config)` behind `--sequential` flag |

---

## Requirements Coverage

| Requirement | Source Plan | Description                                                                                       | Status    | Evidence                                                          |
|-------------|-------------|---------------------------------------------------------------------------------------------------|-----------|-------------------------------------------------------------------|
| EXEC-04     | 03-01, 03-03 | Orchestrator performs topological sort to produce ordered waves                                  | SATISFIED | `topologicalWaves()` in `topological-sort.ts`; called in `wave-runner.ts:44` |
| EXEC-05     | 03-01, 03-03 | Independent tasks within a wave execute in parallel (default 4 workers, configurable)            | SATISFIED | `pLimit(config.maxWorkers)` in `wave-runner.ts:69`                |
| EXEC-06     | 03-01, 03-03 | After each wave completes, all worktrees are merged to main branch                               | SATISFIED | `mergeWaveBranches(successTaskIds)` in `wave-runner.ts:147`       |
| EXEC-07     | 03-01, 03-03 | Worktrees are cleaned up after merge (no stale worktrees left behind)                            | SATISFIED | Per-task `cleanup()` loop in `wave-runner.ts:158-164` + signal handlers |
| EXEC-08     | 03-01, 03-03 | Workers that fail halt their task; the wave continues but failed task is reported                | SATISFIED | try/catch per task inside `limit(async ...)` in `wave-runner.ts:91-128` |
| REVW-01     | 03-02, 03-03 | Sub-Judges run in parallel after every wave with mechanical checks                               | SATISFIED | `Promise.all` of 3 judges in `sub-judge-panel.ts:15-19`; called per wave in `wave-runner.ts:181` |
| REVW-01a    | 03-02, 03-03 | Minimal v1 Sub-Judge set: tsc check, touch-map violation detector, vitest run (if tests exist)   | SATISFIED | `tsc-judge.ts`, `touch-map-judge.ts`, `vitest-judge.ts` all substantive |
| REVW-02     | 03-02, 03-03 | Sub-Judge failure does not halt current wave, but halts progression to next wave                 | SATISFIED | Judges run after all wave tasks complete; `!judgeReport.allPassed` halts next wave at `wave-runner.ts:200` |

All 8 phase-3 requirements satisfied. No orphaned requirements found — all 8 IDs declared in plans correspond to phase-3 entries in REQUIREMENTS.md traceability table.

---

## Anti-Patterns Found

No blocker or warning anti-patterns found. Scan results:

- No TODO/FIXME/HACK/PLACEHOLDER comments in source files
- No placeholder `return null` or `return {}` implementations
- No hardcoded empty data flowing to rendering
- No console.log-only handlers
- All state variables populated by real logic (BFS algorithm, git operations, child_process spawns)

---

## Test Suite Results

- **Total tests:** 101 passed, 0 failed
- **Test files:** 16 passed
- **TypeScript:** `npx tsc --noEmit` — clean (no errors)
- **New tests from phase 3:** 31 tests (7 wave grouping + 4 error handling + 9 integration wave-runner + 14 sub-judge-panel + 3 additional CLI-related from plan 03-03 integration additions)

### Test breakdown for phase-3 files

| Test File                                   | Tests | Status  |
|---------------------------------------------|-------|---------|
| `tests/unit/topological-waves.test.ts`      | 7     | passing |
| `tests/unit/wave-error-handling.test.ts`    | 4     | passing |
| `tests/unit/sub-judge-panel.test.ts`        | 14    | passing |
| `tests/integration/wave-runner.test.ts`     | 9     | passing |

---

## Human Verification Required

### 1. Terminal Output Readability

**Test:** Run `npx anvil run "build a hello world app" --skip-review` against a real project
**Expected:** Wave headers, per-task progress, judge verdicts, and final summary are clear and readable
**Why human:** Visual output formatting, chalk color rendering, and UX clarity cannot be verified programmatically

### 2. Real Anthropic Integration End-to-End

**Test:** Run `anvil run` with a real Anthropic API key on a simple spec
**Expected:** Tasks execute in parallel worktrees, merge successfully, judges run and pass, no stale worktrees remain
**Why human:** Integration tests mock the Anthropic client; real API behavior (tool use, timeouts, rate limits) needs live validation

---

## Gaps Summary

No gaps. All 13 observable truths verified, all 12 artifacts substantive and wired, all 10 key links confirmed by grep. Full test suite (101 tests) passes. TypeScript compilation clean.

Phase 3 goal is fully achieved: independent tasks execute in parallel within waves, merged between waves, with mechanical Sub-Judge checks gating progression.

---

_Verified: 2026-03-21T02:20:00Z_
_Verifier: Claude (gsd-verifier)_
