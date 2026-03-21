# Project Research Summary

**Project:** Anvil -- Lightweight AI Code Factory
**Domain:** AI Agent Orchestration CLI (multi-agent parallel code generation)
**Researched:** 2026-03-20
**Confidence:** HIGH

## Executive Summary

Anvil is a CLI-based multi-agent code factory that decomposes a user spec into a task DAG, executes tasks in parallel via git worktrees, and validates results through a two-tier review system (mechanical Sub-Judges + AI High Court). The expert approach in this space -- validated by Cursor's parallel agents, Forge's pipeline architecture, and emerging patterns from OpenHands and Devin -- is a pipeline-of-stations model: a Planner produces a typed plan with dependency graph and file ownership (touch maps), a Wave Scheduler groups independent tasks for parallel execution, Workers generate code in isolated worktrees, and Judges gate quality before proceeding. Anvil's key differentiator is bringing this pattern to a zero-setup `npx` CLI experience with no Docker, no Python, and no cloud account required.

The recommended approach is pure TypeScript on Node 22 LTS, using the Anthropic SDK directly (no framework abstraction), git worktrees for Worker isolation, and a strict Planner-never-codes / Worker-never-plans separation. The stack is lean: 9 production dependencies, all ESM-only, with better-sqlite3 for audit trails and JSON files for plan/state persistence. Zod 4 validates all trust boundaries (LLM output, plan schemas, config). The architecture builds bottom-up in clear dependency layers: types and infrastructure first, then stations, then orchestration, then review.

The primary risks are: (1) the Planner-Coder Gap -- underspecified plans cause 75% of multi-agent failures, mitigated by requiring explicit interface contracts and shared type signatures in the plan schema; (2) git worktree lifecycle mismanagement -- stale worktrees from crashed runs corrupt subsequent sessions, mitigated by a WorktreeManager with startup cleanup, PID tracking, and signal handlers; (3) token cost explosion -- parallel Workers with retry loops can spiral costs 10-25x, mitigated by real-time budget tracking with circuit breakers wired into every API call from day one. These are not theoretical -- they are the documented failure modes of every multi-agent system in production.

## Key Findings

### Recommended Stack

The stack is high-confidence across the board. All dependencies are current stable releases with active maintenance. The ESM-only strategy aligns naturally with chalk 5, p-limit 6, and ora 8.

**Core technologies:**
- **Node.js >=22 LTS + TypeScript 5.8:** Runtime and type system. Avoid TS 6.0 (RC only) and TS 7.0 (experimental Go rewrite).
- **@anthropic-ai/sdk ^0.80.0:** Direct Claude API access with tool_use, structured outputs, extended thinking, and streaming. No framework abstraction needed.
- **simple-git ^3.33.0:** Git operations including worktrees (via `git.raw()` -- no native worktree methods, needs a typed wrapper).
- **zod ^4.3.6:** Runtime validation at all trust boundaries. Single source of truth for types.
- **better-sqlite3 ^12.8.0:** Audit trail and cost tracking. Synchronous API suits CLI patterns. Node's built-in sqlite is still experimental.
- **p-limit ^6.2.0:** Wave-level concurrency control. Simpler than p-queue, fits the "run N, wait for all" model exactly.
- **commander ^14.0.3:** CLI parsing. Already in package.json, no reason to change.
- **pino ^9.6.0:** Structured JSON logging to `.anvil/logs/`. Separate from terminal output (chalk + ora).

**Explicit exclusions:** LangChain/LangGraph (unnecessary abstraction), Vercel AI SDK (provider abstraction Anvil does not need), Docker (out of scope), ORMs (overkill), interactive prompts (Anvil is non-interactive).

### Expected Features

**Must have (table stakes):**
- Plan-then-execute architecture with visible plan before code generation
- Parallel task execution (wave-based, not sequential)
- Git-native workflow (every AI edit = reviewable commit)
- Automated test/lint validation (Sub-Judges: tsc, test runner, lint)
- Human escalation on uncertainty (PLAN_AMBIGUOUS, PLAN_GAP)
- Cost/token tracking (per-agent, per-wave, cumulative)
- Session state persistence with resume capability
- Multi-file editing with dependency-aware task ordering
- Clear CLI progress indication (wave N/M, task status, verdicts)

**Should have (differentiators):**
- Structured multi-judge review (Sub-Judges + High Court) -- no other CLI tool has this
- Touch map enforcement (file ownership boundaries between parallel agents) -- unique to Anvil
- Handoff-first review (summaries before code, cheaper and faster)
- Zero-setup `npx anvil run` experience (no Docker, no Python, no cloud)
- Full audit trail in `.anvil/` (human-readable, diffable JSON artifacts)
- Ordered wave execution (more reliable than Cursor's fire-and-forget parallelism)

**Defer to v2+:**
- Multi-model/multi-provider support
- MCP/A2A protocol support
- Web UI / dashboard
- IDE integration
- Interactive chat mode
- Plugin system for custom Sub-Judges
- Configuration file (`.anvilrc`)

### Architecture Approach

Anvil follows a pipeline-of-stations architecture: a single long-lived Node.js process (no servers) orchestrates Anthropic API calls and git operations through a finite state machine. Each "station" (Planner, Worker, Sub-Judge, High Court, Librarian) implements a uniform `Station<TInput, TOutput>` interface, making the pipeline composable and independently testable. State transitions are append-only snapshots to `.anvil/state.json`, enabling crash recovery. The build order is strictly layered: types/schemas (Layer 0), infrastructure wrappers (Layer 1), stations (Layer 2), orchestration (Layer 3), review (Layer 4), CLI (Layer 5).

**Major components:**
1. **Orchestrator** -- State machine driving the pipeline; owns all state transitions and delegates to stations
2. **Planner Station** -- Analyzes user spec, produces task DAG with touch maps and interface contracts
3. **Wave Scheduler** -- Kahn's algorithm topological sort, groups independent tasks into parallel waves
4. **Worker Pool + Workers** -- Manage concurrent Workers in isolated git worktrees (default 4 concurrent)
5. **Merge Engine** -- Merges completed worktree branches after each wave completes
6. **Sub-Judge Panel** -- Mechanical checks (tsc, lint, tests, touch map compliance) after each merge
7. **High Court** -- AI architectural review using handoff-first pattern (summaries before code)
8. **Cost Auditor** -- Real-time token/cost tracking with circuit breakers across all API calls

### Critical Pitfalls

1. **Planner-Coder Gap (75% of multi-agent failures)** -- Require explicit interface contracts (TypeScript signatures) in plan schema. Validate that every cross-task dependency has a matching type contract before execution begins.
2. **Git Worktree Lifecycle Mismanagement** -- Build a WorktreeManager with three guarantees: startup cleanup (prune stale worktrees), shutdown cleanup (graceful removal), and signal-handler cleanup (SIGTERM/SIGINT). Track worktrees in `.anvil/worktrees.json` with PIDs and timestamps.
3. **Error Cascade Amplification Across Waves** -- Run full-project `tsc --noEmit` between waves (not just on new files). Consider a "Mini Court" fast LLM check after each wave to catch drift before it compounds.
4. **Token Cost Explosion** -- Wire the Cost Auditor into every API call from day one with per-run budget limits (default $5), per-Worker token caps, and hard retry limits (3 max). This cannot be bolted on later.
5. **Orphaned Child Processes** -- Use process groups, PID tracking in `.anvil/pids.json`, and AbortController for all API calls. Startup must check for and kill orphaned processes from previous runs.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation and Core Types
**Rationale:** Architecture research identifies Layer 0 (types/schemas) and Layer 1 (infrastructure wrappers) as having zero internal dependencies. Everything else depends on them. Getting the Plan schema right here -- with interface contracts and touch maps baked in -- prevents Pitfall 1 from becoming systemic.
**Delivers:** TypeScript project scaffold, all Zod schemas (Plan, Task, Wave, SessionState, Reports), config loader, logger (pino), cost tracking primitives, git wrapper (simple-git + WorktreeManager), Anthropic API wrapper with token counting and AbortController, state persistence (JSON snapshots), CLI scaffold with `run` command.
**Addresses:** CLI framework, multi-file editing groundwork, session state persistence
**Avoids:** Pitfall 9 (cold start DX -- bundle setup), Pitfall 12 (state corruption -- centralized writes from the start)

### Phase 2: Planner Station and Sequential Execution
**Rationale:** The Planner is the highest-risk component (Pitfall 1). Building it early with rich plan validation (cycle detection, touch map consistency, interface contracts) de-risks the entire pipeline. Sequential execution (waves of 1) proves the end-to-end loop without parallelism complexity.
**Delivers:** Planner Station (spec to typed Plan with task DAG), plan validation (cycle detection, touch map consistency), Worker Station (single worker in a git worktree, atomic commits), sequential wave execution, basic cost tracking, handoff document generation.
**Addresses:** Plan-then-execute, git-native workflow, human escalation (PLAN_AMBIGUOUS, PLAN_GAP), dependency-aware ordering
**Avoids:** Pitfall 1 (underspecified plans), Pitfall 13 (dependency cycles), Pitfall 8 (context exhaustion -- context budgeting in Planner)

### Phase 3: Parallel Execution and Mechanical Quality Gates
**Rationale:** With the single-worker loop proven, add parallelism (the core value proposition) and Sub-Judges (the quality safety net). These must be built together because Sub-Judges validate the merged output of parallel workers. Wave-level `tsc --noEmit` prevents Pitfall 3.
**Delivers:** Wave Scheduler (Kahn's algorithm), Worker Pool with p-limit concurrency, worktree lifecycle management (create/merge/cleanup), Merge Engine, Sub-Judge Panel (tsc, test runner, touch map compliance), inter-wave coherence checks, real-time cost circuit breakers.
**Addresses:** Parallel task execution, automated test/lint validation, touch map enforcement, cost tracking with budget limits
**Avoids:** Pitfall 2 (worktree lifecycle), Pitfall 3 (error cascading), Pitfall 4 (orphaned processes), Pitfall 5 (cost explosion), Pitfall 7 (merge order sensitivity)

### Phase 4: AI Review and Intelligence Layer
**Rationale:** High Court and advanced review require all prior phases to be stable. The handoff-first pattern depends on Workers producing structured handoffs (Phase 2) and Sub-Judges providing mechanical validation (Phase 3). This phase adds the architectural judgment layer.
**Delivers:** High Court (AI review with handoff-first + mandatory code sampling), human escalation flow (HUMAN_REQUIRED verdict), full audit trail in `.anvil/`, Librarian (auto-documentation from build artifacts).
**Addresses:** Structured multi-judge review, handoff-first review, full audit trail, auto-documentation
**Avoids:** Pitfall 10 (handoff blindness -- mandatory code sampling for 30% of tasks and all security-sensitive tasks)

### Phase 5: CLI Polish and Distribution
**Rationale:** With the core pipeline working end-to-end with quality gates, polish the user experience. These are independent features that enhance usability without changing the core architecture.
**Delivers:** `anvil resume`, `anvil status`, `anvil cost`, `anvil logs`, `anvil cancel`, `anvil cleanup` commands. `anvil ship --pr` (GitHub PR creation). Rich CLI progress display (ora spinners, chalk output). Graceful Ctrl+C shutdown. npx-optimized bundling with tsup. Pre-execution cost estimation with confirmation.
**Addresses:** Session resume, clear progress indication, zero-setup npx experience
**Avoids:** Pitfall 9 (cold start -- aggressive bundling, lazy-load heavy deps)

### Phase Ordering Rationale

- **Bottom-up by architecture layers:** Each phase maps to 1-2 architecture layers, ensuring no phase depends on components from a later phase.
- **Risk-first sequencing:** The Planner (highest failure rate component) ships in Phase 2 with rich validation, not deferred. Cost circuit breakers ship in Phase 3 alongside the parallel execution that makes them necessary.
- **Prove-then-scale pattern:** Phase 2 proves the single-worker loop. Phase 3 scales it to parallel. Phase 4 adds intelligence. This avoids debugging parallelism and AI review simultaneously.
- **Pitfall alignment:** Every critical pitfall (1-5) is addressed in Phases 1-3, before the system is complex enough for errors to cascade.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Planner Station):** The plan schema design is the highest-leverage decision in the project. Research the exact structured output format (Anthropic's `output_config.format` with Zod schema) for plan generation. Needs prompt engineering research for reliable interface contract extraction.
- **Phase 3 (Parallel Execution):** Git worktree merge strategies when touch maps are correct but semantic conflicts exist. Research the `git merge --no-ff` vs `--squash` trade-offs for worktree branches. Process group management on macOS vs Linux.
- **Phase 4 (High Court):** Optimal code sampling strategy for handoff-first review. How much code review is enough to catch the issues summaries miss?

Phases with standard patterns (skip deep research):
- **Phase 1 (Foundation):** Well-documented TypeScript project setup, Zod schema design, simple-git usage, pino logging. All standard patterns.
- **Phase 5 (CLI Polish):** Commander sub-commands, ora progress display, tsup bundling. Established patterns with extensive documentation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All dependencies verified against npm with current versions. ESM strategy validated. No speculative choices. |
| Features | HIGH | Competitive analysis covers 8 tools. Table stakes validated against market leaders. Differentiators grounded in Forge's proven patterns. |
| Architecture | HIGH | Pipeline-of-stations and wave-based execution are well-documented patterns. Component boundaries are clean. State machine is well-defined. |
| Pitfalls | HIGH | Top pitfalls backed by peer-reviewed research (planner-coder gap) and documented production failures (17x error trap, cost explosion). Mitigations are specific and actionable. |

**Overall confidence:** HIGH

### Gaps to Address

- **Plan schema design:** The exact JSON schema for plans (especially the `shared_interfaces` field for cross-task type contracts) needs iteration during Phase 2 implementation. Research identifies the need but not the optimal format.
- **Worker prompt engineering:** How to structure the Worker system prompt for reliable touch map compliance and handoff document generation. Needs empirical testing.
- **better-sqlite3 vs JSON-only for v1:** PITFALLS.md suggests JSON-only state may be simpler for v1 (avoiding native dependency for npx). STACK.md recommends better-sqlite3. Decision: use JSON for state persistence, add SQLite for audit trail queries if needed. Make SQLite optional.
- **"Mini Court" between waves:** PITFALLS.md suggests a lightweight AI check between waves to catch error cascading. This is not in the current architecture. Evaluate during Phase 3 -- if full-project `tsc --noEmit` catches most issues, defer the Mini Court to v2.
- **Anthropic rate limits under parallel load:** Default 4 workers = 4 concurrent API calls. Need to verify Anthropic's rate limits for the target tier and add appropriate backoff.
- **macOS worktree behavior:** All worktree documentation focuses on Linux. Verify that `git worktree prune`, signal handling, and process groups behave identically on macOS (Anvil's primary development platform).

## Sources

### Primary (HIGH confidence)
- [Anthropic SDK npm](https://www.npmjs.com/package/@anthropic-ai/sdk) -- v0.80.0 API surface
- [Anthropic Structured Outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) -- plan output format
- [simple-git npm](https://www.npmjs.com/package/simple-git) -- v3.33.0 worktree support
- [Zod v4 release notes](https://zod.dev/v4) -- schema validation approach
- [The Planner-Coder Gap (arxiv:2510.10460)](https://arxiv.org/abs/2510.10460) -- 75.3% failure attribution
- [Why Multi-Agent Systems Fail (Augment Code)](https://www.augmentcode.com/guides/why-multi-agent-llm-systems-fail-and-how-to-fix-them) -- 79% specification + coordination failures

### Secondary (MEDIUM confidence)
- [17x Error Trap (Towards Data Science)](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/) -- error amplification patterns
- [Git Worktrees for Parallel AI Agents (Upsun)](https://devcenter.upsun.com/posts/git-worktrees-for-parallel-ai-coding-agents/) -- worktree lifecycle patterns
- [Cursor Parallel Agents Docs](https://cursor.com/docs/configuration/worktrees) -- competitive feature reference
- [AI Agent Orchestration Patterns (Microsoft Azure)](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) -- pipeline architecture validation
- [Best AI Coding Agents 2026 (Codegen)](https://codegen.com/blog/best-ai-coding-agents/) -- competitive landscape

### Tertiary (LOW confidence)
- [Hidden AI Cost Explosion (Chrono)](https://www.chronoinnovation.com/resources/hidden-cost-explosion-in-ai) -- cost scaling claims need validation against Anvil's specific usage patterns
- [AgentFS with SQLite (Turso)](https://turso.tech/blog/agentfs-fuse) -- SQLite for agent state, tangential to Anvil's JSON-first approach

---
*Research completed: 2026-03-20*
*Ready for roadmap: yes*
