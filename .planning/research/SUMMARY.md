# Project Research Summary

**Project:** Anvil v1.1 — Configurable Agent Backends
**Domain:** AI orchestration / pluggable worker execution
**Researched:** 2026-03-21
**Confidence:** HIGH

## Executive Summary

Anvil v1.1 introduces a pluggable worker execution model. The existing architecture drives a single execution path: the raw Anthropic SDK makes one API call per task, manually reads files into the prompt, and parses `write_file` tool-use blocks to write files. The v1.1 milestone replaces this single path with an `AgentAdapter` interface that two backends implement — `sdk` (the current behavior, extracted and wrapped) and `claude-code` (the new default, backed by `@anthropic-ai/claude-agent-sdk`). The Claude Code backend is fundamentally different: it is a multi-turn autonomous agent with its own file tools, test-running capability, and self-correction loop. It must be isolated, constrained, and validated differently from the raw SDK backend.

The recommended approach is to ship this as a clean refactor in strict dependency order: define the adapter interface first, extract the SDK adapter from existing code (zero behavior change), wire adapters into the orchestrators, then implement the Claude Code adapter, and finally augment the Planner with capability-aware task generation. Every step is independently testable and the existing behavior is preserved until the Claude Code adapter is explicitly selected. The single new npm dependency is `@anthropic-ai/claude-agent-sdk`, which provides a typed TypeScript API, structured cost reporting, and programmatic lifecycle control — eliminating any need to parse CLI subprocess output.

The highest-severity risks are not implementation complexity risks but isolation risks: touch-map bypass (Claude Code can write anywhere in the worktree), context leakage (Claude Code reads CLAUDE.md and project settings by default), zombie subprocess accumulation across parallel workers, and cost tracking becoming a black box because CLI agents return session-aggregate costs rather than per-call costs. All five critical pitfalls have known mitigations documented in PITFALLS.md and are preventable by design choices made during the adapter interface phase. The architectural decisions to run `validateTouchMap()` in the orchestrator (not the adapter), use `settingSources: []` and `persistSession: false` in the Agent SDK, and pair `bypassPermissions` with explicit `disallowedTools` address these risks structurally.

## Key Findings

### Recommended Stack

The existing TypeScript stack (TS 5.8, `@anthropic-ai/sdk`, `commander`, `simple-git`, `zod`, `p-limit`, `pino`) requires exactly one addition: `@anthropic-ai/claude-agent-sdk`. No subprocess management library is needed because the Agent SDK is in-process. No other backends (Aider, Cursor CLI) should be added in v1.1 — Aider violates the pure-TypeScript constraint, and Cursor headless mode has documented hanging bugs and no token usage reporting.

**Core technologies:**
- `@anthropic-ai/claude-agent-sdk` (latest): Claude Code worker backend — in-process `query()` async generator, typed `SDKResultMessage` with `total_cost_usd` and `modelUsage`, programmatic `allowedTools`, `maxTurns`, `maxBudgetUsd`, `AbortController` support
- `@anthropic-ai/sdk` ^0.80.0 (already installed): Raw SDK adapter — preserves current single-call behavior exactly, zero new dependency cost
- All existing stack: unchanged — Planner, High Court, and Librarian remain on raw SDK for guaranteed structured output via `zodOutputFormat`; adapters are for Workers only

**Explicitly deferred:**
- Cursor CLI adapter: beta status, documented hanging issues, no token usage in output — defer to v1.2
- Aider adapter: Python dependency (violates pure-TS constraint), no JSON output mode, scripting API explicitly unsupported — defer indefinitely

### Expected Features

**Must have (table stakes):**
- `AgentAdapter` interface with `execute(task, worktreePath, config)` returning `AdapterResult` — the orchestrator's single integration point
- `--agent <backend>` CLI flag defaulting to `claude-code` — required for every multi-backend tool
- Unified cost tracking across both backends — `recordFromAdapter()` on `CostTracker` accepts aggregate usage shape; handles null costs gracefully for future opaque backends
- Backend availability detection at startup — fail fast with actionable error if `claude` CLI is absent when `--agent claude-code` is selected
- Worktree `cwd` passthrough — both adapters operate within the git worktree created for their task

**Should have (differentiators):**
- Capability-aware task generation — the Planner's system prompt is augmented with the selected backend's `AgentCapabilities`, producing executable acceptance criteria (`npm test passes`) for Claude Code and structural criteria for SDK
- Backend-specific system prompts — Claude Code workers get lean task-focused prompts; SDK workers keep the existing verbose tool-instruction prompts
- `allowedTools` scoped per task — restrict Write/Edit to declared `writes[]` paths, allow limited Bash patterns, block all git operations via `disallowedTools`
- `maxTurns` and `maxBudgetUsd` per task — iteration budget control for Claude Code agents
- Post-execution `git diff --name-only` as the authoritative source of truth for `filesWritten`

**Defer to v1.2+:**
- Custom adapter plugin API for third-party backends
- Per-task backend selection or automatic backend fallback
- Cursor CLI adapter
- Aider adapter
- Backend-specific configuration profiles

### Architecture Approach

The adapter pattern inserts a thin interface between the wave-runner/sequential-runner orchestrators and the concrete AI execution mechanism. The key architectural insight is that the two backends represent fundamentally different execution models — not just different API shapes — so the adapter interface must be minimal (single `execute()` method), capabilities must be declared as static data objects (not methods), and all orchestrator-level concerns (git commits, touch-map validation, cost aggregation) must stay in the orchestrator and never leak into adapters.

**Major components:**
1. `src/adapters/types.ts` — `AgentAdapter` interface, `AdapterResult`, `AdapterUsage`, `AgentCapabilities` data types
2. `src/adapters/sdk-adapter.ts` — `SdkAdapter`: verbatim extraction of current `executeTask()` from `workers/worker.ts`, zero behavior change
3. `src/adapters/claude-code-adapter.ts` — `ClaudeCodeAdapter`: `query()` call with `cwd`, `allowedTools` scoped to `writes[]`, `disallowedTools: ['Bash(git *)']`, `settingSources: []`, `persistSession: false`, `maxTurns: 25`, `maxBudgetUsd: 2.00`
4. `src/adapters/index.ts` — `resolveAdapter()` factory keyed on `config.agent`
5. Updated `wave-runner.ts` / `sequential-runner.ts` — accept `adapter` via options; run `validateTouchMap()` AFTER adapter returns (defense-in-depth, adapter-agnostic)
6. `src/prompts/planner-system.ts` — `buildCapabilitySection(capabilities)` injected into Planner system prompt at plan-generation time based on selected adapter

**Invariant:** The Planner, High Court, and Librarian are explicitly excluded from the adapter system. They remain on raw SDK for structured output guarantees via `zodOutputFormat`. Adapters are for Workers only.

### Critical Pitfalls

1. **Touch-map bypass** — Claude Code has unrestricted filesystem access inside the worktree. Mitigate with two layers: `allowedTools` scoped to `writes[]` paths at execution time, plus `validateTouchMap()` via `git diff` as the authoritative post-hoc check. Never trust the agent's self-reported file list.

2. **Context leakage from CLAUDE.md** — Claude Code reads project configuration files automatically, which can override task instructions. Mitigate by setting `settingSources: []` in Agent SDK options, using an explicit `systemPrompt`, and sanitizing `process.env` (pass only `PATH`, `HOME`, `ANTHROPIC_API_KEY`).

3. **Zombie subprocess accumulation** — Claude Code agents are long-running stateful processes. With 4 parallel workers, a parent crash leaves 4 processes burning API credits. Mitigate with `AbortController` wired into each `query()` call, a `Promise.race()` timeout wrapper (5 minutes per task), and `persistSession: false` to prevent session file accumulation.

4. **Cost tracking black box** — CLI backends return session-aggregate costs, not per-call costs. Redefine the adapter contract as aggregate (`costUsd: number | null`, `inputTokens: number | null`), add `recordFromAdapter()` to `CostTracker`, display "cost unknown" for null values rather than crashing or showing $0.00.

5. **Permission prompts blocking non-interactive execution** — Claude Code hangs waiting for stdin if permissions are not pre-configured. Always use `permissionMode: 'bypassPermissions'` with `allowDangerouslySkipPermissions: true` paired with explicit `disallowedTools`. Validate non-interactive execution as the first integration test for the Claude Code adapter.

## Implications for Roadmap

Research identifies a strict 8-step dependency-ordered build sequence that maps cleanly to 4 phases, each leaving the system in a fully passing state.

### Phase 1: Adapter Interface and SDK Extraction

**Rationale:** Zero behavior change, zero new dependencies. Pure TypeScript refactoring that establishes the contract every subsequent step depends on. Safest first step and unblocks all downstream work immediately.
**Delivers:** `src/adapters/types.ts` with `AgentAdapter`, `AdapterResult`, `AdapterUsage`, `AgentCapabilities`; `SdkAdapter` class containing the verbatim body of current `executeTask()`; all existing tests pass unchanged.
**Addresses:** Table-stakes adapter interface feature; API key routing (pitfall 11) and cost tracking contract (pitfall 2) must be designed at the interface level here.
**Avoids:** The fat adapter interface anti-pattern — capabilities declared as data, single `execute()` method only.

### Phase 2: Orchestrator Wiring and Config

**Rationale:** Connects the new interface to the execution path without touching agent backends. Makes adapter selection configurable and relocates `validateTouchMap()` from `worker.ts` into the orchestrator — where it must live for both adapters.
**Delivers:** `--agent` CLI flag; `agent` field in `AnvilConfigSchema`; `resolveAdapter()` factory; `wave-runner` and `sequential-runner` delegating to `adapter.execute()`; `validateTouchMap()` running post-adapter in orchestrator; `CostTracker.recordFromAdapter()` method.
**Uses:** `zod`, `commander` (already installed); no new npm dependencies.
**Implements:** Full orchestrator wiring — selecting `--agent sdk` must be functionally identical to v1.0 behavior.

### Phase 3: Claude Code Adapter

**Rationale:** First phase requiring a new npm dependency and new runtime behavior. Isolated by the adapter interface from previous phases. This is the core new capability and where all five critical pitfalls must be addressed.
**Delivers:** `ClaudeCodeAdapter` using `@anthropic-ai/claude-agent-sdk`; `cwd` set to worktree path; `settingSources: []` and `persistSession: false` for environment isolation; `disallowedTools: ['Bash(git *)']` preventing git operations; per-task `allowedTools` scoped to `writes[]`; `AbortController` timeout wrapper; `filesWritten` derived from `git diff --name-only`.
**Must avoid:** Context leakage (pitfall 5) — `settingSources: []` is mandatory, not optional. Zombie processes (pitfall 3) — `AbortController` and 5-minute timeout must be in place before any integration testing. Permission hangs (pitfall 9) — non-interactive execution must be the first integration test.
**Research flag:** ARCHITECTURE.md contains a full `ClaudeCodeAdapter` implementation prototype verified against official Agent SDK docs. No additional research phase needed.

### Phase 4: Capability-Aware Planning

**Rationale:** Unlocks the full value of the Claude Code adapter. Without it, plans are written for a dumb single-shot executor and the capable agent is underutilized. Comes last because it requires both adapters' `AgentCapabilities` constants to be established.
**Delivers:** `buildCapabilitySection(capabilities)` injected into Planner system prompt at plan-generation time; Claude Code plans use executable acceptance criteria (`npm test passes`, `npx tsc --noEmit exits 0`) and coarser task granularity (3-5 files); SDK plans retain exact structural criteria and fine-grained tasks (1-2 files).
**Uses:** Static `AgentCapabilities` constants from both adapter classes; `generatePlan()` signature extended with optional `capabilities` parameter.
**Implements:** Capability-injected Planner prompt pattern from ARCHITECTURE.md and FEATURES.md deep dive.

### Phase Ordering Rationale

- Phases 1-2 preserve existing behavior throughout — the system stays shippable and all existing tests pass.
- Phase 3 is the only phase introducing a new npm dependency and new subprocess semantics; isolating it means failures are clearly localized.
- Phase 4 depends on Phase 3's `AgentCapabilities` constants being finalized; it cannot be accurately designed until both adapters exist.
- All five critical pitfalls are addressed in Phase 3, where they originate. They cannot be deferred to Phase 4.
- The Planner, High Court, and Librarian are structurally excluded from the adapter system — this constraint is load-bearing and must not be violated.

### Research Flags

All phases have well-documented patterns — no `/gsd:research-phase` needed:
- **Phase 1:** Pure TypeScript interface design; standard adapter pattern derived directly from existing codebase types
- **Phase 2:** All integration points specified in ARCHITECTURE.md with specific file paths and current line numbers
- **Phase 3:** HIGH confidence from official Agent SDK TypeScript reference; full implementation prototype in ARCHITECTURE.md, verified against Agent SDK source
- **Phase 4:** Planner prompt augmentation; clear specification with code examples in both FEATURES.md and ARCHITECTURE.md

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Agent SDK API surface verified against official docs and npm registry; adapter interface derived directly from existing `WorkerResult` type and `executeTask()` signature |
| Features | HIGH | Feature set tightly scoped to existing codebase; all table-stakes features derived from current `worker.ts` and `wave-runner.ts` behavior; anti-features are explicit and well-reasoned |
| Architecture | HIGH | Integration points identified with specific file paths and line numbers in existing source; `ClaudeCodeAdapter` prototype verified against Agent SDK reference |
| Pitfalls | HIGH | All 5 critical pitfalls have specific, actionable mitigations; sources include official Agent SDK security documentation and production-proven patterns |

**Overall confidence:** HIGH

### Gaps to Address

- **`cancel()` lifecycle method:** PITFALLS.md recommends `cancel()` and `isRunning()` on the adapter interface for orchestrator-controlled shutdown; ARCHITECTURE.md's interface omits them in favor of `AbortController` passed at execution time. Resolve during Phase 1: either add lifecycle methods or document that `AbortController` is the shutdown contract.
- **`filesWritten` accuracy:** The `ClaudeCodeAdapter` prototype sets `filesWritten: task.writes` (declared intent) rather than actual filesystem state. The post-execution `validateTouchMap()` catches violations, but `AdapterResult.filesWritten` should reflect reality. Clarify during Phase 1 whether this field is "files written" or "files declared to write."
- **Bash allow-list exhaustiveness:** The `allowedTools` Bash patterns (`npm *`, `npx *`, `node *`, `cat *`, `ls *`) cover most cases but miss projects using `pnpm`, `yarn`, or `bun`. Acceptable as a v1.1 limitation — document it and expose `agentAllowedTools` as an optional `AnvilConfig` override.

## Sources

### Primary (HIGH confidence)
- [Claude Code Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — `query()` API, `Options` type, `SDKResultMessage` with `usage`/`total_cost_usd`/`modelUsage`, permission modes, `settingSources`, `persistSession`
- [Run Claude Code Programmatically](https://code.claude.com/docs/en/headless) — Agent SDK overview, headless mode, `--allowedTools` syntax, permission rule syntax
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) — package confirmed active and installable
- Existing Anvil source code: `src/workers/worker.ts`, `src/orchestrator/wave-runner.ts`, `src/orchestrator/sequential-runner.ts`, `src/cost/tracker.ts`, `src/schemas/config.ts`, `src/stations/planner.ts` — primary integration reference

### Secondary (MEDIUM confidence)
- [Cursor CLI headless docs](https://cursor.com/docs/cli/headless) — beta status confirmed, no token usage, defer recommendation validated
- [Cursor headless hanging bug report](https://forum.cursor.com/t/cursor-agent-p-print-headless-mode-hangs-indefinitely-and-never-returns/150246) — known reliability issue confirmed
- [Aider scripting docs](https://aider.chat/docs/scripting.html) — Python-only, no JSON output, unsupported scripting API confirmed
- [Practical Security for Sandboxing Agentic Workflows (NVIDIA)](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/) — filesystem write restrictions as mandatory control
- [Adapter to Actor: AI Integration Patterns](https://pasmontesinos.com/en/posts/ai-integration-patterns-adapter-actor/) — adapter pattern for LLM backends

### Tertiary (MEDIUM confidence, inferred from patterns)
- [Agent Design Patterns — Lance Martin](https://rlancemartin.github.io/2026/01/09/agent_design/) — planner-executor separation
- [Google Multi-Agent Patterns in ADK](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) — orchestrator assigns subtasks to specialized agents
- [Using Git Worktrees with AI Agents (Nick Mitchinson)](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/) — worktree isolation patterns

---
*Research completed: 2026-03-21*
*Ready for roadmap: yes*
