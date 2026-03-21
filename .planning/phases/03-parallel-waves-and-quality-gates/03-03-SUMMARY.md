---
phase: 03-parallel-waves-and-quality-gates
plan: 03
subsystem: orchestrator
tags: [sub-judge-integration, wave-runner, cli-wiring, quality-gates, parallel-execution]

requires:
  - phase: 03-parallel-waves-and-quality-gates
    plan: 01
    provides: "executeInWaves, WaveExecutionResult, WaveReport, topologicalWaves"
  - phase: 03-parallel-waves-and-quality-gates
    plan: 02
    provides: "runSubJudges, SubJudgeReport, tsc/vitest/touch-map judges"
provides:
  - "Wave runner with Sub-Judge quality gates after each wave"
  - "CLI defaults to parallel wave execution with --sequential fallback"
  - "Judge reports included in WaveExecutionResult and saved to .anvil/reports/"
affects: [04-high-court, cli-run-command]

tech-stack:
  added: []
  patterns: [sub-judge-gating-after-wave-merge, baseline-sha-capture-before-merge, combined-failure-reporting]

key-files:
  created: []
  modified:
    - src/orchestrator/wave-runner.ts
    - src/cli.ts
    - tests/integration/wave-runner.test.ts

key-decisions:
  - "Capture baseline SHA via git.revparse(['HEAD']) before merge step for accurate Sub-Judge touch-map diffing"
  - "Both task failures and Sub-Judge failures independently halt wave progression; all reported together"
  - "CLI saves judge reports to .anvil/reports/ in wave execution mode for audit trail"

patterns-established:
  - "Quality gate pattern: execute tasks -> merge -> capture baseline -> run judges -> halt or proceed"
  - "Combined failure reporting: task failures + judge failures collected and reported in single halt message"

requirements-completed: [EXEC-04, EXEC-05, EXEC-06, EXEC-07, EXEC-08, REVW-01, REVW-01a, REVW-02]

duration: 4min
completed: 2026-03-21
---

# Phase 03 Plan 03: Sub-Judge Integration and CLI Wiring Summary

**Wave runner gates progression via Sub-Judge panel after each wave merge; CLI defaults to parallel wave execution with --sequential fallback**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-21T02:09:45Z
- **Completed:** 2026-03-21T02:14:00Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments
- Wave runner calls `runSubJudges(baseDir, waveNumber, tasks, baselineSha)` after merging each wave
- `WaveExecutionResult` now includes `judgeReports: SubJudgeReport[]` for consumer access
- Sub-Judge failure (allPassed=false) halts progression independently from task failures
- CLI `run` command defaults to `executeInWaves` for parallel wave execution
- `--sequential` flag falls back to `executeSequentially` for backward compatibility
- Judge results printed with green checkmarks (passed) and red X (failed) per check
- Judge reports saved to `.anvil/reports/` from CLI for audit trail
- 3 new integration tests covering judge integration, judge failure halt, and combined failure scenarios

## Task Commits

Each task was committed atomically:

1. **Task 1: Integrate Sub-Judges into wave runner and wire CLI** - `fc18e45` (feat)

## Files Modified
- `src/orchestrator/wave-runner.ts` - Added runSubJudges import, judgeReports in result, baseline SHA capture, judge gating after merge
- `src/cli.ts` - Added executeInWaves import, --sequential flag, wave execution as default, judge report saving and display
- `tests/integration/wave-runner.test.ts` - Added runSubJudges mock, 3 new tests (judge reports populated, judge failure halts, combined failures)

## Decisions Made
- Capture baseline SHA with `git.revparse(['HEAD'])` before merge step so Sub-Judge touch-map checker can accurately diff the wave's changes
- Both task failures and Sub-Judge failures independently halt progression; combined in a single halt message with reasons
- CLI saves judge reports to `.anvil/reports/` directory alongside the existing Sub-Judge panel report saving

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed simple-git import style**
- **Found during:** Task 1 (tsc type check)
- **Issue:** Used `import simpleGit from 'simple-git'` (default import) but project uses named import
- **Fix:** Changed to `import { simpleGit } from 'simple-git'` matching project convention
- **Files modified:** src/orchestrator/wave-runner.ts

## Issues Encountered
None beyond the auto-fixed deviation above.

## Known Stubs
None - all data sources wired, no placeholder data.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 complete: parallel wave execution with Sub-Judge quality gates fully operational
- High Court (Phase 4) can hook into `WaveExecutionResult.judgeReports` for architectural review input
- CLI pipeline: spec -> plan -> review -> parallel wave execution with judges -> result reporting

## Self-Check: PASSED

All 3 modified files verified on disk. Task commit fc18e45 verified in git history.

---
*Phase: 03-parallel-waves-and-quality-gates*
*Completed: 2026-03-21*
