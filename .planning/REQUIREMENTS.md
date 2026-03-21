# Requirements: Anvil

**Defined:** 2026-03-20
**Core Value:** `npx anvil run "Build X"` produces a complete, reviewed, production-ready project with clean git history and full audit trail — in under 5 minutes, with zero manual setup.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### CLI

- [x] **CLI-01**: User can run `anvil run "spec"` to start a full build pipeline from natural language
- [x] **CLI-02**: User can run `anvil status` to see the current/last build state and audit trail
- [x] **CLI-03**: User can run `anvil cost` to see token usage and cost breakdown per agent per wave
- [x] **CLI-04**: User can run `anvil logs` to view detailed build logs for any wave or task
- [x] **CLI-05**: CLI prints config summary on startup (project name, model, max workers)

### Planner

- [x] **PLAN-01**: Planner Station accepts natural-language spec and produces a JSON plan with tasks, touch maps, and dependency graph
- [x] **PLAN-02**: Each task in the plan declares `writes[]`, `reads[]`, and `depends_on[]`
- [x] **PLAN-03**: Planner rejects plans with overlapping writes between tasks (merges into single task or re-plans)
- [x] **PLAN-04**: Plan is validated against a JSON schema before execution begins
- [x] **PLAN-05**: Single interactive prompt after plan generation: "Review plan before starting execution? (Y/n/edit)" — 'edit' opens plan JSON in $EDITOR, re-validates on save
- [x] **PLAN-06**: Plan is saved to `.anvil/roadmap.json` for inspection

### Execution

- [x] **EXEC-01**: Each task runs in an isolated git worktree on a dedicated branch
- [x] **EXEC-02**: Workers can only read/write files declared in their task's touch map
- [x] **EXEC-03**: Every Worker change is an atomic git commit with a descriptive message
- [x] **EXEC-04**: Orchestrator performs topological sort on dependency graph to produce ordered waves
- [x] **EXEC-05**: Independent tasks within a wave execute in parallel (default 4 workers, configurable)
- [x] **EXEC-06**: After each wave completes, all worktrees are merged to main branch
- [x] **EXEC-07**: Worktrees are cleaned up after merge (no stale worktrees left behind)
- [x] **EXEC-08**: Workers that fail halt their task; the wave continues but the failed task is reported
- [x] **EXEC-09**: If High Court aborts or escalates, rollback last wave merge (git reset --hard + worktree cleanup) — bad architecture never leaks into main

### Review

- [x] **REVW-01**: Sub-Judges run in parallel after every wave with mechanical checks
- [x] **REVW-01a**: Minimal v1 Sub-Judge set: tsc check, touch-map violation detector, vitest run (if tests exist)
- [x] **REVW-02**: Sub-Judge failure does not halt current wave (other tasks finish), but halts progression to next wave — all failures reported together
- [x] **REVW-03**: High Court performs a single end-of-build AI architectural review
- [x] **REVW-04**: High Court produces one of three decisions: merge (approve), human_required (print flags + save `.anvil/high-court-report.json`), or abort (rollback)
- [x] **REVW-05**: High Court checks: architectural invariants, no circular dependencies, cross-task coherence

### Cost

- [x] **COST-01**: Token usage (input/output/cache) is tracked per agent call
- [x] **COST-02**: Cost is calculated per wave and per session using model pricing
- [x] **COST-03**: Cost summary is displayed at build completion
- [x] **COST-04**: Cost report is saved to `.anvil/cost-report.json`

### Librarian

- [x] **LIBR-01**: Librarian auto-generates README.md from build artifacts after High Court approval
- [x] **LIBR-02**: Librarian auto-generates ARCHITECTURE.md from project structure and High Court notes
- [x] **LIBR-03**: Generated docs are committed as atomic commits in the project's git history

### CLI UX

- [ ] **CLUX-01**: Live progress display showing current wave, task status, and judge verdicts
- [ ] **CLUX-02**: Color-coded output: green (passed), yellow (warning), red (failed/escalation)
- [ ] **CLUX-03**: Build completion summary with next steps (status, cost, git push, ship --pr)
- [x] **CLUX-04**: `.anvil/` folder contains full audit trail: plan, wave reports, judge verdicts, cost summary

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Session Management

- **SESS-01**: User can resume a crashed or interrupted build with `anvil resume`
- **SESS-02**: User can cancel a running build with `anvil cancel`
- **SESS-03**: State checkpoints persist after each wave for crash recovery

### Escalation

- **ESCL-01**: Planner emits PLAN_AMBIGUOUS when uncertain, halts and asks human for clarification
- **ESCL-02**: Worker emits PLAN_GAP when plan is architecturally wrong, routes back to Planner
- **ESCL-03**: Human escalation displays structured questions with context

### Advanced Review

- **ARVW-01**: Workers produce structured handoff documents for High Court
- **ARVW-02**: High Court reads handoffs first, dives into code only on escalation (handoff-first review)

### Distribution

- **DIST-01**: `npx anvil@latest run "..."` works with zero prerequisites beyond Node 22
- **DIST-02**: `anvil ship --pr` creates a GitHub PR with full build report

### Configuration

- **CONF-01**: `.anvilrc` configuration file for default model, max workers, cost caps
- **CONF-02**: Custom Sub-Judge plugins (user-defined mechanical checks)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web UI / Dashboard | Anvil targets solo devs in terminals, not teams. CLI-first. |
| Multi-model / multi-provider | Anthropic SDK only for v1. Model abstraction adds bugs. |
| Docker / container sandboxing | Git worktrees provide sufficient isolation. Docker = 40GB RAM. |
| IDE integration / LSP | Cursor owns IDE space. Anvil is CLI-only. |
| Real-time collaboration / team features | Single-user CLI. Solo dev focus. |
| Browser automation / web browsing | Orthogonal to code generation. Massive complexity. |
| Interactive chat / conversational mode | Command-first, not chat-first. `anvil run` is the interface. |
| Self-healing / unlimited auto-retry | Bounded retries only. Fail fast, escalate to human. |
| MCP / A2A protocol support | Internal agents only. No external protocol surface for v1. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLI-01 | Phase 2 | Complete |
| CLI-02 | Phase 5 | Complete |
| CLI-03 | Phase 5 | Complete |
| CLI-04 | Phase 5 | Complete |
| CLI-05 | Phase 1 | Complete |
| PLAN-01 | Phase 2 | Complete |
| PLAN-02 | Phase 2 | Complete |
| PLAN-03 | Phase 2 | Complete |
| PLAN-04 | Phase 1 | Complete |
| PLAN-05 | Phase 2 | Complete |
| PLAN-06 | Phase 1 | Complete |
| EXEC-01 | Phase 2 | Complete |
| EXEC-02 | Phase 2 | Complete |
| EXEC-03 | Phase 2 | Complete |
| EXEC-04 | Phase 3 | Complete |
| EXEC-05 | Phase 3 | Complete |
| EXEC-06 | Phase 3 | Complete |
| EXEC-07 | Phase 3 | Complete |
| EXEC-08 | Phase 3 | Complete |
| EXEC-09 | Phase 4 | Complete |
| REVW-01 | Phase 3 | Complete |
| REVW-01a | Phase 3 | Complete |
| REVW-02 | Phase 3 | Complete |
| REVW-03 | Phase 4 | Complete |
| REVW-04 | Phase 4 | Complete |
| REVW-05 | Phase 4 | Complete |
| COST-01 | Phase 4 | Complete |
| COST-02 | Phase 4 | Complete |
| COST-03 | Phase 4 | Complete |
| COST-04 | Phase 4 | Complete |
| LIBR-01 | Phase 4 | Complete |
| LIBR-02 | Phase 4 | Complete |
| LIBR-03 | Phase 4 | Complete |
| CLUX-01 | Phase 5 | Pending |
| CLUX-02 | Phase 5 | Pending |
| CLUX-03 | Phase 5 | Pending |
| CLUX-04 | Phase 1 | Complete |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0

---
*Requirements defined: 2026-03-20*
*Last updated: 2026-03-20 after roadmap creation*
