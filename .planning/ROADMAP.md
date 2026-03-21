# Roadmap: Anvil

## Overview

Anvil builds bottom-up: foundation types and infrastructure first, then the Planner and a single-worker proof-of-concept, then parallel wave execution with mechanical quality gates, then AI review and documentation, and finally CLI polish. Each phase delivers a testable, coherent capability. The Planner ships early (Phase 2) because it is the highest-risk component -- underspecified plans cause 75% of multi-agent failures.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - TypeScript scaffold, Zod schemas, infrastructure wrappers, CLI entry point
- [ ] **Phase 2: Planner and Sequential Execution** - Planner station produces validated plans; single Worker executes tasks in git worktrees
- [ ] **Phase 3: Parallel Waves and Quality Gates** - Wave scheduler, parallel worker pool, merge engine, Sub-Judge panel
- [ ] **Phase 4: AI Review and Audit Trail** - High Court architectural review, Librarian documentation, cost tracking
- [ ] **Phase 5: CLI Polish** - Status/cost/logs commands, live progress display, color output, completion summary

## Phase Details

### Phase 1: Foundation
**Goal**: A runnable CLI skeleton with all core types, schemas, and infrastructure wrappers in place -- the base everything else builds on
**Depends on**: Nothing (first phase)
**Requirements**: CLI-05, PLAN-04, PLAN-06, CLUX-04
**Success Criteria** (what must be TRUE):
  1. Running `anvil run "test"` prints a config summary (project name, model, max workers) and exits cleanly
  2. All core Zod schemas (Plan, Task, Wave, SessionState, SubJudgeReport, HighCourtReport, CostReport) exist and validate sample data
  3. The `.anvil/` folder is created on run with the expected structure (roadmap.json placeholder, logs/, reports/)
  4. Plan validation rejects malformed JSON and accepts well-formed plans against the schema
**Plans**: 2 plans

Plans:
- [x] 01-01-PLAN.md -- Project scaffold, Zod schemas, and test infrastructure
- [x] 01-02-PLAN.md -- Core modules (anvil-dir, config-loader, validator, logger) and CLI entry point

### Phase 2: Planner and Sequential Execution
**Goal**: A user can provide a natural-language spec and get a validated plan with tasks, then watch a single Worker execute each task sequentially in git worktrees with atomic commits
**Depends on**: Phase 1
**Requirements**: CLI-01, PLAN-01, PLAN-02, PLAN-03, PLAN-05, EXEC-01, EXEC-02, EXEC-03
**Success Criteria** (what must be TRUE):
  1. User runs `anvil run "Build a REST API"` and the Planner produces a JSON plan with tasks declaring writes[], reads[], and depends_on[]
  2. Plans with overlapping writes between tasks are rejected and the Planner re-plans or merges tasks
  3. User is prompted "Review plan before starting execution? (Y/n/edit)" — 'edit' opens the plan JSON in $EDITOR, re-validates on save
  4. Each task executes in its own git worktree on a dedicated branch, only touching files declared in its touch map
  5. Every Worker change appears as an atomic git commit with a descriptive message in the project's git history
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Planner Station with structured outputs, overlap detection, topological sort
- [x] 02-02-PLAN.md — WorktreeManager, Worker executor, touch-map enforcement
- [x] 02-03-PLAN.md — Plan review UI, sequential runner, CLI pipeline wiring

### Phase 3: Parallel Waves and Quality Gates
**Goal**: Independent tasks execute in parallel within waves, merged between waves, with mechanical Sub-Judge checks gating progression
**Depends on**: Phase 2
**Requirements**: EXEC-04, EXEC-05, EXEC-06, EXEC-07, EXEC-08, REVW-01, REVW-01a, REVW-02
**Success Criteria** (what must be TRUE):
  1. Tasks are sorted into waves via topological sort on the dependency graph, and independent tasks within a wave run in parallel (up to configured concurrency)
  2. After each wave completes, all worktree branches are merged to main and worktrees are cleaned up (no stale worktrees remain)
  3. Sub-Judges run after every wave: minimal v1 set = tsc check, touch-map violation detector, vitest run (if tests exist)
  4. A Sub-Judge failure does not halt the current wave (other tasks finish), but halts progression to the next wave -- all failures reported together
  5. A failed Worker task is reported but does not crash the entire wave; other tasks in the wave complete
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: AI Review and Audit Trail
**Goal**: Completed builds receive an AI architectural review from High Court, auto-generated documentation from the Librarian, and full cost tracking throughout
**Depends on**: Phase 3
**Requirements**: REVW-03, REVW-04, REVW-05, EXEC-09, LIBR-01, LIBR-02, LIBR-03, COST-01, COST-02, COST-03, COST-04
**Success Criteria** (what must be TRUE):
  1. After all waves complete, High Court performs an AI architectural review and produces a verdict: merge, human_required, or abort. On human_required: print what was flagged + suggested fixes, save structured report to `.anvil/high-court-report.json`
  2. High Court checks for architectural invariants, circular dependencies, and cross-task coherence
  3. If High Court aborts or escalates, last wave merge is rolled back (git reset --hard + worktree cleanup) — bad architecture never leaks into main
  4. After High Court approval, the Librarian generates README.md and ARCHITECTURE.md from build artifacts, committed as atomic commits
  5. Token usage (input/output/cache) is tracked per agent call, with cost calculated per wave and per session
  6. A cost summary is displayed at build completion and saved to `.anvil/cost-report.json`
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD
- [ ] 04-03: TBD

### Phase 5: CLI Polish
**Goal**: Users have full visibility into builds via status, cost, and log commands, with a polished terminal experience
**Depends on**: Phase 4
**Requirements**: CLI-02, CLI-03, CLI-04, CLUX-01, CLUX-02, CLUX-03
**Success Criteria** (what must be TRUE):
  1. User can run `anvil status` to see the current or last build state including wave progress and audit trail
  2. User can run `anvil cost` to see a token/cost breakdown per agent and per wave
  3. User can run `anvil logs` to view detailed logs for any specific wave or task
  4. Live progress display shows current wave, task status, and judge verdicts during a build
  5. Output is color-coded (green for passed, yellow for warnings, red for failures) and build completion shows a summary with next steps
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/2 | Complete | 2026-03-21 |
| 2. Planner and Sequential Execution | 0/3 | Planning complete | - |
| 3. Parallel Waves and Quality Gates | 0/? | Not started | - |
| 4. AI Review and Audit Trail | 0/? | Not started | - |
| 5. CLI Polish | 0/? | Not started | - |
