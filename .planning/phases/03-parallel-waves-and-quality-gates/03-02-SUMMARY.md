---
phase: 03-parallel-waves-and-quality-gates
plan: 02
subsystem: testing
tags: [sub-judges, tsc, vitest, touch-map, child-process, quality-gates]

# Dependency graph
requires:
  - phase: 01-cli-and-schemas
    provides: SubJudgeCheck and SubJudgeReport Zod schemas in src/schemas/reports.ts
  - phase: 02-planner-and-worker
    provides: Task type with writes[] array from src/schemas/plan.ts
provides:
  - runTscCheck() spawns tsc --noEmit and returns SubJudgeCheck
  - runVitestCheck() spawns vitest run (if test files exist) and returns SubJudgeCheck
  - runTouchMapCheck() diffs baselineSha..HEAD against task writes[] and returns SubJudgeCheck
  - runSubJudges() orchestrates all three judges in parallel via Promise.all, returns SubJudgeReport
  - SubJudgeReport saved to .anvil/reports/wave-{N}-judges.json
affects: [03-01-wave-runner, 04-high-court]

# Tech tracking
tech-stack:
  added: []
  patterns: [child-process-spawner-for-deterministic-checks, skip-on-missing-config]

key-files:
  created:
    - src/judges/tsc-judge.ts
    - src/judges/vitest-judge.ts
    - src/judges/touch-map-judge.ts
    - src/judges/sub-judge-panel.ts
    - tests/unit/sub-judge-panel.test.ts
  modified: []

key-decisions:
  - "Used execFile with promisify for tsc/vitest spawning (no execa dependency needed)"
  - "Touch-map judge accepts baselineSha parameter from caller rather than computing HEAD~N"
  - "Vitest judge uses find command to detect test files before running (avoids hanging on empty projects)"

patterns-established:
  - "Sub-Judge pattern: thin wrapper around existing tool, check preconditions first (skip if missing), spawn child process, interpret exit code"
  - "Report persistence: save JSON report to .anvil/reports/ after each judge panel run"

requirements-completed: [REVW-01, REVW-01a, REVW-02]

# Metrics
duration: 4min
completed: 2026-03-21
---

# Phase 03 Plan 02: Sub-Judge Panel Summary

**Three mechanical Sub-Judges (tsc, vitest, touch-map) orchestrated in parallel via Promise.all, producing SubJudgeReport with allPassed gating**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-21T02:02:21Z
- **Completed:** 2026-03-21T02:07:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Three deterministic Sub-Judge checkers: tsc (compilation), vitest (test suite), touch-map (write violation detection)
- Panel orchestrator runs all three in parallel and computes allPassed boolean
- Report persisted to `.anvil/reports/wave-{N}-judges.json` for audit trail
- 14 unit tests covering success/failure/skip for each judge plus orchestrator behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Build three Sub-Judge checkers** - `b4c0fff` (test: TDD RED), `d892291` (feat: TDD GREEN)
2. **Task 2: Build Sub-Judge panel orchestrator** - `f1a23fa` (test: TDD RED), `ea33d4f` (feat: TDD GREEN)

_Note: TDD tasks have two commits each (test then implementation)_

## Files Created/Modified
- `src/judges/tsc-judge.ts` - Spawns tsc --noEmit via child_process, skips if no tsconfig.json
- `src/judges/vitest-judge.ts` - Spawns npx vitest run via child_process, skips if no test files found
- `src/judges/touch-map-judge.ts` - Diffs baselineSha..HEAD via simple-git, checks against task writes[]
- `src/judges/sub-judge-panel.ts` - Orchestrates all three judges in parallel, saves report to disk
- `tests/unit/sub-judge-panel.test.ts` - 14 tests covering all judges and orchestrator

## Decisions Made
- Used `execFile` with `promisify` from `node:child_process` instead of adding `execa` dependency -- sufficient for spawning known binaries with timeout control
- Touch-map judge accepts `baselineSha` parameter from caller rather than computing `HEAD~N` -- more accurate and avoids counting merge commits
- Vitest judge uses `find` command to detect test files before attempting `npx vitest run` -- prevents hanging on projects without tests
- Symlinked node_modules in vitest judge tests to avoid installing dependencies in temp directories

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed vitest judge test needing node_modules in temp directory**
- **Found during:** Task 1 (vitest-judge tests)
- **Issue:** Temp directory for vitest success/failure tests had no node_modules, so `npx vitest run` could not resolve vitest
- **Fix:** Symlinked project's node_modules into temp test directories
- **Files modified:** tests/unit/sub-judge-panel.test.ts
- **Verification:** All 9 tests pass including vitest success and failure cases
- **Committed in:** d892291 (Task 1 implementation commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary fix for test infrastructure. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Sub-Judge panel ready to be wired into wave runner (03-01)
- `runSubJudges(projectDir, waveNumber, tasks, baselineSha)` is the integration point
- Wave runner needs to capture HEAD SHA before merges as the baselineSha parameter

---
*Phase: 03-parallel-waves-and-quality-gates*
*Completed: 2026-03-21*
