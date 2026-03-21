---
phase: 03-parallel-waves-and-quality-gates
plan: 01
subsystem: orchestrator
tags: [topological-sort, parallel-execution, p-limit, git-worktrees, wave-runner]

requires:
  - phase: 02-planner-and-workers
    provides: "WorktreeManager, executeTask, topologicalSort, sequential-runner"
provides:
  - "topologicalWaves() BFS-level wave grouping from dependency DAG"
  - "executeInWaves() parallel wave execution engine with p-limit concurrency"
  - "commitInWorktree() separated commit for wave-based execution"
  - "mergeWaveBranches() deterministic batch merge after each wave"
  - "WaveExecutionResult and WaveReport types for Sub-Judge integration"
affects: [03-02-sub-judges, 03-03-high-court, cli-run-command]

tech-stack:
  added: [p-limit ^6.2.0]
  patterns: [BFS-level wave grouping, p-limit concurrency control, error-isolation via try/catch in Promise.all]

key-files:
  created:
    - src/orchestrator/wave-runner.ts
    - tests/unit/topological-waves.test.ts
    - tests/unit/wave-error-handling.test.ts
    - tests/integration/wave-runner.test.ts
  modified:
    - src/core/topological-sort.ts
    - src/git/worktree-manager.ts
    - package.json

key-decisions:
  - "p-limit v6 (ESM-only) for concurrency control; simpler than p-queue for wave model"
  - "Halt on any wave failure rather than continue to next wave (fail-fast for dependent tasks)"
  - "Deterministic merge order via sorted taskIds within mergeWaveBranches"
  - "WaveReport as hook point for future Sub-Judge integration (no judge calls yet)"

patterns-established:
  - "Wave execution: BFS grouping -> parallel execute -> batch merge -> cleanup -> next wave"
  - "Error isolation: each task wrapped in try/catch inside p-limit, failures recorded not thrown"
  - "Separated commit/merge: commitInWorktree for wave, mergeWaveBranches for batch"

requirements-completed: [EXEC-04, EXEC-05, EXEC-06, EXEC-07, EXEC-08]

duration: 5min
completed: 2026-03-21
---

# Phase 03 Plan 01: Parallel Wave Execution Engine Summary

**BFS-level topological wave grouping with p-limit parallel execution, deterministic batch merge, and error isolation across independent tasks**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-21T02:02:21Z
- **Completed:** 2026-03-21T02:07:01Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- topologicalWaves() groups tasks by BFS level in the dependency DAG, producing Wave[] with deterministic ordering
- executeInWaves() runs independent tasks in parallel (up to maxWorkers) within each wave, merges per wave, cleans up worktrees
- Error isolation ensures one failed task does not crash others in the same wave; failures halt progression to next wave
- 17 new tests (7 wave grouping + 4 error handling + 6 integration) all pass alongside 76 existing tests

## Task Commits

Each task was committed atomically:

1. **Task 1: topologicalWaves + batch merge (RED)** - `b63fc52` (test)
2. **Task 1: topologicalWaves + batch merge (GREEN)** - `5965eda` (feat)
3. **Task 2: wave-runner integration tests (RED)** - `1816161` (test)
4. **Task 2: wave-runner implementation (GREEN)** - `dc649c4` (feat)

## Files Created/Modified
- `src/core/topological-sort.ts` - Added topologicalWaves() BFS-level grouping alongside existing topologicalSort()
- `src/git/worktree-manager.ts` - Added commitInWorktree() and mergeWaveBranches() for separated commit/merge workflow
- `src/orchestrator/wave-runner.ts` - New parallel wave execution engine with p-limit, error isolation, signal handlers
- `tests/unit/topological-waves.test.ts` - 7 unit tests for wave grouping (linear, independent, single, cycle, empty, diamond)
- `tests/unit/wave-error-handling.test.ts` - 4 unit tests for error isolation pattern
- `tests/integration/wave-runner.test.ts` - 6 integration tests with real git repos and mocked Anthropic client
- `package.json` - Added p-limit ^6.2.0 dependency

## Decisions Made
- Used p-limit v6 (ESM-only) for concurrency control; simpler model than p-queue fits wave execution perfectly
- Halt progression on any wave failure rather than continuing (fail-fast prevents dependent tasks from running on broken foundation)
- Deterministic merge order via sorted taskIds ensures reproducible git history
- WaveReport type serves as hook point for Sub-Judge integration (Plan 02) without coupling

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing test failure in `tests/unit/sub-judge-panel.test.ts` (imports non-existent `src/judges/sub-judge-panel.js` from Plan 03-02). Not caused by our changes; tracked as parallel work.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Wave runner ready for Sub-Judge gating (Plan 02 will use WaveReport to trigger judge checks)
- executeInWaves has same function signature pattern as executeSequentially for easy CLI swapping
- All worktree lifecycle methods tested with real git operations

## Self-Check: PASSED

All 6 created/modified source files verified on disk. All 4 task commits verified in git history.

---
*Phase: 03-parallel-waves-and-quality-gates*
*Completed: 2026-03-21*
