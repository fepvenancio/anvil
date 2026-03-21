---
phase: 02-planner-and-sequential-execution
plan: 02
subsystem: execution
tags: [git-worktree, simple-git, anthropic-sdk, touch-map, worker, isolation]

requires:
  - phase: 01-cli-skeleton-and-schemas
    provides: Task/Plan schemas with writes[]/reads[]/dependsOn[] fields, .anvil/ directory structure
provides:
  - WorktreeManager class for git worktree lifecycle (create, commit, merge, cleanup)
  - validateTouchMap function for post-execution file change verification
  - executeTask Worker function with Claude API tool_use pattern
  - WORKER_SYSTEM_PROMPT and WORKER_TOOLS for Worker agent configuration
affects: [02-03-sequential-runner, 03-wave-execution, review-system]

tech-stack:
  added: [simple-git@3.33.0, "@anthropic-ai/sdk@0.80.0"]
  patterns: [worktree-isolation, touch-map-enforcement, tool-use-worker-pattern]

key-files:
  created:
    - src/git/worktree-manager.ts
    - src/workers/worker.ts
    - src/prompts/worker-system.ts
    - tests/unit/touch-map.test.ts
    - tests/integration/worktree.test.ts
  modified:
    - src/index.ts
    - package.json

key-decisions:
  - "Used named import { simpleGit } for ESM compatibility with simple-git"
  - "Worker uses tool_use pattern (write_file/report_error) instead of structured output for multi-file code generation"
  - "Touch map validation via git diff --name-only + ls-files for untracked detection"

patterns-established:
  - "Worktree isolation: each task gets anvil/run-{uuid}/task-{id} branch in .anvil/worktrees/"
  - "Touch map enforcement: post-execution validation before commit, not filesystem-level restriction"
  - "Worker tool pattern: write_file for file creation, report_error for failure reporting"

requirements-completed: [EXEC-01, EXEC-02, EXEC-03]

duration: 3min
completed: 2026-03-21
---

# Phase 02 Plan 02: Worker and Worktree Summary

**WorktreeManager with git worktree isolation and Worker executor using Claude tool_use pattern for touch-map-enforced task execution**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-21T00:48:29Z
- **Completed:** 2026-03-21T00:51:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- WorktreeManager class with full lifecycle: create worktrees on dedicated branches, commit and merge with --no-ff, cleanup with fallback to manual rm + prune
- validateTouchMap function that detects unauthorized file modifications via git diff and untracked file detection
- Worker executor (executeTask) that calls Claude API with write_file/report_error tools, writes files to worktree, and validates touch map before reporting success
- 8 tests (4 unit for touch-map, 4 integration for worktree lifecycle) all passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Create WorktreeManager with git worktree lifecycle and touch-map validation** - `2e0fe6b` (feat)
2. **Task 2: Create Worker executor with Claude API and touch-map enforcement** - `6aa8552` (feat)

## Files Created/Modified
- `src/git/worktree-manager.ts` - WorktreeManager class and validateTouchMap function
- `src/workers/worker.ts` - executeTask function with Claude API integration
- `src/prompts/worker-system.ts` - WORKER_SYSTEM_PROMPT and WORKER_TOOLS definitions
- `tests/unit/touch-map.test.ts` - Touch map validation unit tests
- `tests/integration/worktree.test.ts` - Worktree lifecycle integration tests with real git
- `src/index.ts` - Barrel exports for WorktreeManager, validateTouchMap, executeTask, WorkerResult
- `package.json` - Added @anthropic-ai/sdk and simple-git dependencies

## Decisions Made
- Used `{ simpleGit }` named import instead of default import for ESM/TypeScript compatibility with `module: "node16"`
- Worker uses tool_use pattern (write_file/report_error) rather than structured output, as recommended by research for multi-file code generation
- Touch map validation uses `git diff --name-only HEAD` + `ls-files --others` to catch both modified and untracked files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing @anthropic-ai/sdk and simple-git dependencies**
- **Found during:** Task 1 (pre-execution check)
- **Issue:** Package.json did not include simple-git or @anthropic-ai/sdk (removed in Phase 1 per decision)
- **Fix:** Ran `npm install @anthropic-ai/sdk@^0.80.0 simple-git@^3.33.0`
- **Files modified:** package.json, package-lock.json
- **Verification:** Imports resolve, tsc passes
- **Committed in:** 2e0fe6b (Task 1 commit)

**2. [Rule 1 - Bug] Fixed simpleGit import for ESM compatibility**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** Default import `import simpleGit from 'simple-git'` produces "not callable" error with module: "node16"
- **Fix:** Changed to named import `import { simpleGit } from 'simple-git'`
- **Files modified:** src/git/worktree-manager.ts
- **Verification:** tsc --noEmit passes cleanly
- **Committed in:** 2e0fe6b (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required. ANTHROPIC_API_KEY will be needed at runtime but is not required for building/testing.

## Next Phase Readiness
- WorktreeManager and Worker are ready for the sequential runner (02-03) to orchestrate
- Sequential runner will create worktrees, call executeTask, then commitAndMerge for each task in order
- All tests pass (49 total, 0 failures), typecheck clean

## Self-Check: PASSED

All files verified on disk. Commits 2e0fe6b and 6aa8552 confirmed in git log. All 49 tests pass. tsc --noEmit clean.

---
*Phase: 02-planner-and-sequential-execution*
*Completed: 2026-03-21*
