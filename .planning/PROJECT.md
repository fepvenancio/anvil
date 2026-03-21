# Anvil — Lightweight AI Code Factory

## What This Is

Anvil is a pure TypeScript CLI that orchestrates a team of AI agents to build entire projects from a single natural-language command. It's the spiritual successor to [Forge](https://github.com/fepvenancio/forge) — same structured agent roles (Planner, Workers, Sub-Judges, High Court, Librarian, Cost Auditor), same review rigor, but radically simplified: no Docker, no Python, no Dolt, no monorepo. One command, zero setup.

Target user: solo devs who loved Forge's power but hated the 40GB RAM / Docker / Python gate setup.

## Core Value

`npx anvil run "Build X"` produces a complete, reviewed, production-ready project with clean git history and full audit trail — in under 5 minutes, with zero manual setup.

## Requirements

### Validated

- ✓ CLI skeleton with `run` command entry point — Phase 1
- ✓ Core Zod schemas (Plan, Task, Wave, Session, Reports, Config) — Phase 1
- ✓ Plan validation against schema (accepts/rejects correctly) — Phase 1
- ✓ `.anvil/` directory initialization with audit structure — Phase 1
- ✓ Planner Station: spec → JSON plan with tasks, touch maps, dependency graph — Phase 2
- ✓ Overlap detection: rejects plans with conflicting writes — Phase 2
- ✓ Plan review prompt (Y/n/edit with $EDITOR) — Phase 2
- ✓ Worker execution in isolated git worktrees with atomic commits — Phase 2
- ✓ Touch-map enforcement: workers only modify declared files — Phase 2
- ✓ Sequential task execution pipeline (Planner → review → execute) — Phase 2

### Active

- [ ] CLI with commands: `status`, `cost`, `logs`, `resume`, `cancel`, `ship --pr`
- [ ] Worker Stations: execute tasks in isolated git worktrees with atomic commits
- [ ] Ordered Wave execution: topological sort on dependency graph, parallel within waves, sequential across waves
- [ ] Touch map enforcement: Workers can only read/write declared files
- [ ] Sub-Judges: parallel mechanical checks after every wave (syntax/tsc, tests, security, touch map compliance)
- [ ] High Court: single end-of-build architectural review (merge/human_required/abort decisions)
- [ ] Librarian: auto-generates docs (README, ARCHITECTURE, OpenAPI) from build artifacts
- [ ] Cost Auditor: token/cost tracking per agent per wave, session summary
- [ ] Human escalation: PLAN_AMBIGUOUS (Planner uncertain) and PLAN_GAP (Worker discovers plan is wrong)
- [ ] Full git audit trail: every Worker change is an atomic commit with clear message
- [ ] `.anvil/` folder with roadmap, audit log, cost report

### Out of Scope

- Docker containers for worker isolation — git worktrees are sufficient
- Python or any non-TypeScript runtime — pure TS only
- Dolt database — JSON + SQLite for all state
- Streamlit dashboard or web UI — CLI only for v1
- Multi-model support — Anthropic SDK (Claude) only for v1
- Monorepo / pnpm workspaces — single package
- Flow documents / Librarian staleness tracking — simplified doc generation only
- Network-disabled sandboxing — trust model for v1 (Workers run locally)

## Context

**Origin:** Forge (github.com/fepvenancio/forge) is a powerful AI code factory with a complex stack: Docker containers, Python gates, Dolt database, LangGraph state machine, 20+ parallel workers needing 44GB RAM. Anvil keeps Forge's agent philosophy and review rigor but strips the infrastructure to pure TypeScript.

**Key architectural decisions from Forge to preserve:**
- Planner never writes code, Workers never plan
- Touch maps enforce file ownership per task
- No overlapping writes — Planner must merge conflicting tasks or reject
- Sub-Judges are mechanical (no AI) — deterministic gates
- High Court is AI-powered — reads handoffs first, code only if escalated
- PLAN_AMBIGUOUS and PLAN_GAP are success cases (better to halt than guess)
- Handoff-first review: High Court reads Worker summaries, dives into code only when needed

**Forge agent schemas to adapt:**
- `plan.schema.json` → task structure with id, writes, reads, depends_on, acceptance_criteria
- `sub-judge-report.schema.json` → check results (pass/fail/warn per gate)
- `high-court-report.schema.json` → decision + merge order + invariant checks
- `cycle-cost-report.schema.json` → per-stage token/cost breakdown

**Worker coordination model (Ordered Waves):**
1. Planner produces dependency graph (no overlapping writes allowed)
2. Orchestrator runs topological sort
3. Wave N = all tasks whose dependencies are satisfied
4. Each task runs in its own git worktree (parallel within wave)
5. After wave completes: merge all worktrees → main, run Sub-Judges
6. Next wave starts from updated main
7. High Court runs once after all waves complete

## Constraints

- **Tech stack**: Pure TypeScript, Node 22+, @anthropic-ai/sdk, simple-git, commander. No Docker, no Python, no Dolt.
- **Installation**: Must work via `npx anvil@latest run "..."` — zero prerequisites beyond Node 22
- **State**: JSON files + optional SQLite (better-sqlite3) for audit trail. No external databases.
- **Model**: Anthropic Claude only (claude-3-7-sonnet as default). No multi-provider abstraction for v1.
- **Parallelism**: Default 4 parallel workers. Configurable via CLI flag.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Git worktrees instead of Docker | Zero-setup isolation, no RAM overhead, still prevents file conflicts | — Pending |
| Ordered Waves (topo sort) | Eliminates concurrent merge conflicts entirely. Simpler than Forge's Docker-based parallelism | — Pending |
| JSON plan format (not XML) | TypeScript-native, easier to parse/validate, schema-friendly | — Pending |
| Sub-Judges after every wave | Catch issues early, before dependent tasks build on broken foundations | — Pending |
| High Court once at end | Full-project architectural review is more valuable than per-wave | — Pending |
| Handoff-first review | High Court reads summaries, dives into code only on escalation — faster and cheaper | — Pending |
| PLAN_AMBIGUOUS / PLAN_GAP halts | Better to ask than guess. Same as Forge — users love this | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-21 after Phase 2 completion*
