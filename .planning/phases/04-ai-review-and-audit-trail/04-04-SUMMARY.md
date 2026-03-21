---
phase: 04-ai-review-and-audit-trail
plan: 04
subsystem: cli
tags: [cost-tracking, rollback, high-court, librarian, pipeline, simple-git]

# Dependency graph
requires:
  - phase: 04-ai-review-and-audit-trail (plan 01)
    provides: CostTracker, pricing table, TokenUsage interface
  - phase: 04-ai-review-and-audit-trail (plan 02)
    provides: runHighCourt with structured verdicts and costTracker support
  - phase: 04-ai-review-and-audit-trail (plan 03)
    provides: runLibrarian with README/ARCHITECTURE generation and costTracker support
provides:
  - Full post-wave pipeline in CLI (High Court, rollback, Librarian, cost display)
  - Cost display formatting module (formatCostSummary)
  - Worker usage extraction (WorkerResult.usage field)
  - CostTracker threading through wave-runner to workers
  - Rollback on abort/human_required via git reset --hard
  - Cost report saved to .anvil/cost-report.json
affects: [05-cli-polish]

# Tech tracking
tech-stack:
  added: []
  patterns: [post-wave pipeline pattern, baseline SHA capture for rollback, cost tracking throughout pipeline]

key-files:
  created:
    - src/cost/display.ts
    - tests/unit/cost-display.test.ts
    - tests/integration/rollback.test.ts
    - tests/integration/cost-report.test.ts
  modified:
    - src/cli.ts
    - src/workers/worker.ts
    - src/orchestrator/wave-runner.ts

key-decisions:
  - "Worker returns raw API usage in WorkerResult for CostTracker to process (null-safe with ?? coercion)"
  - "Baseline SHA captured before executeInWaves for accurate rollback scope"
  - "Cost report saved on ALL outcomes (success, abort, wave failure) for auditability"
  - "Planner cost not tracked in this plan (would require planner.ts changes -- future work)"

patterns-established:
  - "Pipeline pattern: waves -> High Court -> rollback/Librarian -> cost display -> cost save"
  - "Rollback pattern: capture baseline SHA, git reset --hard on abort/human_required"

requirements-completed: [EXEC-09, COST-03, COST-04]

# Metrics
duration: 4min
completed: 2026-03-21
---

# Phase 4 Plan 4: Pipeline Wiring Summary

**Full post-wave pipeline: High Court gate with rollback on abort/human_required, Librarian docs on merge, cost display and report save via CostTracker threaded through all agents**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-21T03:53:47Z
- **Completed:** 2026-03-21T03:58:08Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created cost display module (formatCostSummary) with per-agent table and session total
- Extended Worker to return API usage data and wave-runner to thread CostTracker
- Wired full post-wave pipeline in CLI: baseline SHA capture, High Court, rollback, Librarian, cost report
- Added rollback integration tests verifying git reset --hard with real git operations
- Added cost report integration tests verifying JSON write/read/validate cycle

## Task Commits

Each task was committed atomically:

1. **Task 1: Cost display module + Worker usage extraction + wave-runner CostTracker threading** - `9f66878` (feat)
2. **Task 2: CLI pipeline wiring -- High Court, rollback, Librarian, cost report** - `ea38c18` (feat)

## Files Created/Modified
- `src/cost/display.ts` - formatCostSummary function for terminal cost table output
- `src/workers/worker.ts` - Extended WorkerResult with optional usage field
- `src/orchestrator/wave-runner.ts` - CostTracker threading and worker cost recording
- `src/cli.ts` - Full post-wave pipeline: High Court, rollback, Librarian, cost display/save
- `tests/unit/cost-display.test.ts` - 4 unit tests for cost display formatting
- `tests/integration/rollback.test.ts` - 3 integration tests for git rollback with real repos
- `tests/integration/cost-report.test.ts` - 3 integration tests for cost report write/validate

## Decisions Made
- Worker returns raw API usage in WorkerResult (null coerced to undefined at wave-runner boundary for CostTracker compatibility)
- Baseline SHA captured before executeInWaves, not after, so rollback covers all wave merges
- Cost report saved on ALL outcomes (success, abort, wave failure) for complete auditability
- Planner cost not tracked yet (would require planner.ts to return usage data -- Phase 5 or future work)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed null vs undefined type mismatch in WorkerResult.usage**
- **Found during:** Task 1 (Worker usage extraction)
- **Issue:** Anthropic SDK Usage type has cache fields as `number | null`, but CostTracker.recordFromResponse expects `number | undefined`
- **Fix:** Changed WorkerResult.usage cache fields to accept `null`, added `?? undefined` coercion in wave-runner when passing to recordFromResponse
- **Files modified:** src/workers/worker.ts, src/orchestrator/wave-runner.ts
- **Verification:** `npx tsc --noEmit` passes cleanly
- **Committed in:** 9f66878 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Type safety fix required for SDK compatibility. No scope creep.

## Issues Encountered
None beyond the type mismatch documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 4 is now complete: all 4 plans delivered
- Full pipeline operational: Planner -> Workers (parallel waves) -> Sub-Judges -> High Court -> Rollback/Librarian -> Cost tracking
- Ready for Phase 5: CLI polish (status, cost, logs commands, live progress display)

## Self-Check: PASSED

- All 7 files verified present on disk
- Commit 9f66878 verified in git log
- Commit ea38c18 verified in git log
- TypeScript compiles cleanly (npx tsc --noEmit)
- Full test suite green: 23 test files, 147 tests passed

---
*Phase: 04-ai-review-and-audit-trail*
*Completed: 2026-03-21*
