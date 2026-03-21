# Feature Landscape: Configurable Agent Backends

**Domain:** AI Agent Orchestration / Configurable Worker Backends
**Researched:** 2026-03-21
**Context:** v1.1 milestone — making Anvil Workers pluggable executors via `--agent <backend>`

## Table Stakes

Features that any configurable backend system must have. Without these, the abstraction creates more problems than it solves.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Agent adapter interface** | Every backend must conform to a single contract. Without a shared interface, the orchestrator leaks backend-specific logic everywhere. The adapter pattern is standard for this (Vercel AI SDK, LangChain, OpenHands all use it). | Medium | TypeScript interface: `executeTask(task, worktreePath, config) => Promise<WorkerResult>`. Both `claude-code` and `sdk` adapters implement it. The current `executeTask()` in `workers/worker.ts` IS the raw SDK adapter already — extract the interface, wrap current code as `SdkAdapter`. |
| **CLI flag for backend selection** | `--agent claude-code` or `--agent sdk`. Users must be able to choose at invocation time. Every multi-backend tool provides a flag or config key. | Low | Commander option on the `run` command. Default: `claude-code`. Validate against registered adapter names. Store in config so it flows through to the orchestrator. |
| **Cost tracking across backends** | Both backends must report token usage in a unified format. The current `WorkerResult.usage` field works for SDK. Claude Code's Agent SDK provides token counts in message metadata. If cost tracking breaks when switching backends, users lose a table-stakes feature. | Medium | `WorkerResult.usage` stays the same shape. Each adapter is responsible for extracting tokens from its backend's response format and normalizing into `{ input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }`. |
| **Error propagation with context** | When a Claude Code subprocess fails (timeout, crash, permission denied, CLI not installed), the error must surface clearly — not silently produce empty output. Backend-specific errors need wrapping into a common error type. | Low | `WorkerResult.error` already handles this. Adapters catch backend-specific exceptions and wrap them. Add a `backendError?: string` field for raw backend error details alongside the user-facing `error`. |
| **Backend availability detection** | `claude-code` backend requires the `claude` CLI to be installed. If it's missing, fail fast with a clear message at startup, not mid-wave. Aider does this for `git` and model API keys. | Low | On startup (before planning), probe for the selected backend's prerequisites. For `claude-code`: check `which claude` or spawn `claude --version`. For `sdk`: check `ANTHROPIC_API_KEY` env var. Fail with actionable error message. |
| **Worktree path passthrough** | Both backends must operate within the git worktree created for their task. The SDK adapter controls file writes via tool calls. Claude Code needs `cwd` set to the worktree path so its Bash/Edit/Read tools operate on the right directory. | Low | SDK adapter: already works (reads/writes via `join(worktreePath, path)`). Claude Code adapter: pass `cwd: worktreePath` in the Agent SDK `query()` options. |

## Differentiators

Features that make Anvil's backend system genuinely useful vs. a thin wrapper.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Capability-aware task generation** | The Planner tailors tasks based on what the Worker backend CAN do. Claude Code can run tests, iterate on failures, and read the whole repo. Raw SDK can only write declared files. A plan generated for Claude Code should say "implement and verify tests pass" while SDK tasks say "write these files." This is the core insight from the milestone context. | High | See dedicated section below. This is the single most important differentiator. |
| **Claude Code as default backend** | Claude Code CLI has file editing, Bash execution, test running, error iteration, and full repo context built in. Raw SDK workers write files blind — one shot, no iteration. Making Claude Code the default gives every Anvil user agent-quality execution without Anvil reimplementing those capabilities. | Medium | The Agent SDK (`@anthropic-ai/claude-agent-sdk`) provides a TypeScript API: `query({ prompt, options: { cwd, allowedTools, permissionMode, maxTurns, model, systemPrompt } })`. Use it directly — no subprocess shell-out needed. |
| **Backend-specific system prompts** | SDK workers need detailed tool instructions (write_file, report_error). Claude Code workers need task-focused instructions only — Claude Code's built-in system prompt already handles file operations, testing, and error recovery. Different prompts per backend = better results. | Medium | `getSystemPrompt(backend: string): string`. SDK prompt = current `WORKER_SYSTEM_PROMPT` (explicit tool instructions). Claude Code prompt = task-focused only: "You are implementing task X. Your working directory is the project root. Implement the described changes and verify they work." |
| **Allowed tools configuration per backend** | Claude Code has Bash, Read, Edit, Write, Glob, Grep, etc. Anvil should control which tools are permitted — e.g., allow file operations but restrict network access. The Agent SDK `allowedTools` option supports this. | Low | For `claude-code` adapter: `allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep']`. Exclude network tools, TodoWrite, Agent (subagent spawning). Configurable via `AnvilConfig.agentAllowedTools`. |
| **Touch map enforcement strategy per backend** | SDK adapter enforces touch maps by only providing `write_file` tool calls and post-checking the diff. Claude Code adapter must use `allowedTools` restrictions AND post-execution `git diff` validation, because Claude Code can write arbitrary files via Bash/Edit. The enforcement strategy differs. | Medium | SDK: current approach (validate after). Claude Code: restrict tools where possible, but MUST validate via `git diff --name-only` against `task.writes[]` after execution. The post-check is the source of truth for both. |
| **Iteration budget per task** | Claude Code agents can iterate (run tests, fix errors, retry). Raw SDK gets one shot. Exposing `maxTurns` for Claude Code lets users control how many iterations a task gets before the adapter gives up. Prevents runaway costs while enabling self-correction. | Low | `AnvilConfig.maxWorkerTurns` (default: 10 for claude-code, 1 for sdk). Passed as `maxTurns` in Agent SDK `query()` options. |
| **Structured output extraction from Claude Code** | Claude Code returns streaming messages, not structured tool_use blocks like the SDK. The adapter must extract "what files were written" from the message stream to populate `WorkerResult.filesWritten`. | Medium | After Claude Code execution, run `git diff --name-only HEAD` in the worktree to determine what was actually written. More reliable than parsing message streams. The worktree diff IS the source of truth. |

## Capability-Aware Task Generation (Deep Dive)

This is the central feature of the milestone: **the Planner must know what the Worker backend can do and generate tasks accordingly.**

### Capability Model

Each backend declares its capabilities:

```typescript
interface AgentCapabilities {
  canRunTests: boolean;        // Can execute test suites
  canRunLinters: boolean;      // Can run tsc, eslint, etc.
  canIterateOnErrors: boolean; // Can see errors and retry
  canReadArbitraryFiles: boolean; // Can read files beyond reads[]
  canExecuteCommands: boolean; // Can run Bash commands
  maxFilesPerTask: number;     // Practical limit on files per task
  supportsMultiTurn: boolean;  // Can do multiple reasoning turns
}
```

**SDK backend capabilities:**
```typescript
{
  canRunTests: false,
  canRunLinters: false,
  canIterateOnErrors: false,
  canReadArbitraryFiles: false,
  canExecuteCommands: false,
  maxFilesPerTask: 5,       // Context window limits practical output
  supportsMultiTurn: false,  // Single API call, tool_use response
}
```

**Claude Code backend capabilities:**
```typescript
{
  canRunTests: true,
  canRunLinters: true,
  canIterateOnErrors: true,
  canReadArbitraryFiles: true,
  canExecuteCommands: true,
  maxFilesPerTask: 15,      // Can handle more via iterative editing
  supportsMultiTurn: true,
}
```

### How the Planner Adapts

The Planner system prompt is augmented with capability information. Key differences:

| Planning Aspect | SDK Backend | Claude Code Backend |
|----------------|-------------|-------------------|
| **Acceptance criteria** | Descriptive only ("exports User type with id, name, email fields") | Executable ("npm test passes", "tsc --noEmit exits 0") |
| **Task granularity** | Small tasks, 1-3 files each, highly specific function signatures | Larger tasks, 5-10 files, can describe behavior rather than exact signatures |
| **Error handling** | Must specify exact error types and return signatures | "Handle errors appropriately" is acceptable — agent will iterate |
| **Test expectations** | Tests are a SEPARATE task (Worker can't verify) | "Write implementation AND tests, verify tests pass" in SAME task |
| **Context needs** | `reads[]` must list every file the Worker needs | `reads[]` is a hint; Claude Code can discover additional context |
| **Implementation detail** | Exact function signatures, type definitions, import paths | Higher-level behavioral descriptions; agent fills in details |
| **Dependency chains** | More tasks = more dependency edges = more waves | Fewer, larger tasks = fewer waves = faster execution |

### Planner Prompt Injection

The Planner system prompt gets a capability block prepended:

```
WORKER CAPABILITIES:
- Backend: claude-code
- Can run tests: YES — include "npm test passes" in acceptance criteria
- Can iterate on errors: YES — tasks can be broader, worker will self-correct
- Can execute commands: YES — can verify builds, run linters, check output
- Can read arbitrary files: YES — reads[] is advisory, worker discovers context

TASK GENERATION RULES (adapted for capable backend):
- Combine related implementation + test into single tasks when practical
- Use executable acceptance criteria: "tsc --noEmit exits 0", "vitest run passes"
- Describe behavior, not just signatures — worker can determine implementation details
- Prefer fewer, larger tasks over many small ones to reduce wave overhead
```

vs. for SDK:

```
WORKER CAPABILITIES:
- Backend: sdk (raw API)
- Can run tests: NO — acceptance criteria must be descriptive, not executable
- Can iterate on errors: NO — worker gets ONE attempt, must be precise
- Can execute commands: NO — worker can only write files via write_file tool
- Can read arbitrary files: NO — only files listed in reads[] are available

TASK GENERATION RULES (adapted for limited backend):
- Keep tasks small: 1-3 files maximum
- Specify exact function signatures, type definitions, and import paths
- Acceptance criteria must be verifiable by reading code, not by running it
- Always separate implementation from tests (different tasks)
- reads[] must comprehensively list every file the worker needs for context
```

### Impact on Wave Structure

With a capable backend (Claude Code):
- **Fewer waves** (fewer, larger tasks mean fewer dependency levels)
- **Each task is more self-contained** (implementation + verification in one)
- **Sub-Judges are confirmation**, not the primary quality gate (Worker already ran tests)
- **Faster total execution** despite each task taking longer

With a limited backend (SDK):
- **More waves** (many small, precisely specified tasks)
- **Sub-Judges are critical** (they're the ONLY verification — Worker can't self-check)
- **More deterministic** (precise specs = predictable output)
- **Cheaper per-task** (single API call, no iteration)

## Anti-Features

Features to explicitly NOT build for this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Custom adapter plugin API** | Tempting to make adapters fully pluggable for third-party backends (Aider, Codex, etc.). But the interface isn't stable yet — shipping a plugin API before the interface is proven creates backwards compatibility debt. | Two built-in adapters only: `claude-code` and `sdk`. Hardcode the registry. Extract plugin API in v1.2+ after the interface stabilizes. |
| **Runtime backend switching** | Switching backends mid-build (e.g., use Claude Code for complex tasks, SDK for simple ones). Sounds smart, breaks the "Planner generates capability-aware tasks" model — you'd need per-task capability matching. | One backend per session. Selected at invocation via `--agent`. Planner generates a consistent plan for that backend. |
| **Backend-specific plan schemas** | Different task schemas for different backends (e.g., `executableCriteria` field only for Claude Code). Adds schema complexity and makes plans non-portable. | Same `Task` schema for all backends. The Planner writes different CONTENT in the same fields based on capabilities. `acceptanceCriteria` can be executable ("npm test passes") or descriptive ("exports User type") — the schema doesn't change. |
| **Automatic backend fallback** | "Try Claude Code, fall back to SDK if CLI not installed." Hidden behavior creates confusing cost/quality differences. | Fail fast if selected backend is unavailable. Error message: "Claude Code CLI not found. Install it with `npm install -g @anthropic-ai/claude-code` or use `--agent sdk`." |
| **Persistent sessions per task** | Claude Code Agent SDK supports `resume` for continuing conversations. Tempting to keep a Worker session alive across waves for context. But this breaks the isolation model — each task should be independent. | One-shot query per task. No session persistence across tasks. Worktree state is the shared context, not conversation history. |
| **Dynamic capability probing** | Detecting capabilities at runtime by testing what the backend can do. Fragile, slow, and capabilities should be known statically for each adapter. | Static capability declaration per adapter. `SdkAdapter.capabilities` and `ClaudeCodeAdapter.capabilities` are constants. |

## Feature Dependencies

```
AnvilConfig (add `agent` field)
  |
  +-> CLI flag (--agent <backend>)
  |     |
  |     +-> Backend availability check (startup probe)
  |
  +-> AgentCapabilities interface (static per adapter)
  |     |
  |     +-> Planner system prompt augmentation
  |           |
  |           +-> Capability-aware task generation
  |                 (fewer/larger tasks for capable backends,
  |                  more/smaller tasks for limited backends)
  |
  +-> AgentAdapter interface (common contract)
        |
        +-> SdkAdapter (extract from current worker.ts)
        |     |
        |     +-> Current tool-based execution (write_file, report_error)
        |     +-> Touch map validation (current approach)
        |     +-> Token extraction from response.usage
        |
        +-> ClaudeCodeAdapter (new)
              |
              +-> Agent SDK query() call with cwd, allowedTools, maxTurns
              +-> Touch map validation via git diff post-check
              +-> Token extraction from SDK message stream
              +-> Result extraction via git diff --name-only
```

**Critical path:** AgentAdapter interface -> SdkAdapter extraction -> ClaudeCodeAdapter implementation -> Planner prompt augmentation -> integration testing.

The adapter interface and SDK extraction can happen WITHOUT Claude Code — just refactoring existing code. Claude Code adapter and capability-aware planning are the new work.

## MVP Recommendation for v1.1

**Phase 1 - Extract and interface:**
1. Define `AgentAdapter` interface and `AgentCapabilities` type
2. Extract current `executeTask()` into `SdkAdapter` implementing `AgentAdapter`
3. Add `agent` field to `AnvilConfig` + `--agent` CLI flag
4. Backend availability check at startup
5. Wire adapter selection into `wave-runner.ts`

**Phase 2 - Claude Code adapter:**
1. Implement `ClaudeCodeAdapter` using `@anthropic-ai/claude-agent-sdk`
2. Configure `cwd`, `allowedTools`, `permissionMode`, `maxTurns`
3. Extract `filesWritten` via `git diff --name-only`
4. Extract token usage from SDK message metadata
5. Post-execution touch map validation via git diff

**Phase 3 - Capability-aware planning:**
1. Define `AgentCapabilities` constants for each adapter
2. Augment Planner system prompt with capability block
3. Adjust task generation rules based on capabilities
4. Integration test: same spec produces different plans for sdk vs claude-code

**Defer to v1.2+:**
- Custom adapter plugin API
- Additional built-in adapters (Aider, Codex CLI)
- Per-task backend selection
- Backend-specific configuration profiles

## Sources

- [Claude Code Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- `query()` API, Options type, allowedTools, maxTurns, cwd, permissionMode, model. HIGH confidence.
- [Claude Code Headless/Programmatic Usage](https://code.claude.com/docs/en/headless) -- `-p` flag, `--output-format json`, `--allowedTools`, subprocess patterns. HIGH confidence.
- [Adapter to Actor: AI Integration Patterns](https://pasmontesinos.com/en/posts/ai-integration-patterns-adapter-actor/) -- Adapter pattern for LLM backends: treat LLM as infrastructure behind an interface. MEDIUM confidence.
- [Agent Design Patterns - Lance Martin](https://rlancemartin.github.io/2026/01/09/agent_design/) -- Planner-executor pattern, orchestrator coordination patterns. MEDIUM confidence.
- [Google Multi-Agent Patterns in ADK](https://developers.googleblog.com/developers-guide-to-multi-agent-patterns-in-adk/) -- Orchestrator assigns subtasks to specialized agents. MEDIUM confidence.
- [Aider Documentation](https://aider.chat/docs/) -- CLI agent capabilities: file editing, test running, multi-model support. MEDIUM confidence.
- [OpenCode Agent Skills](https://opencode.ai/docs/skills/) -- Skills/capabilities registry pattern for agent systems. MEDIUM confidence.
- Current Anvil source code: `src/workers/worker.ts`, `src/stations/planner.ts`, `src/schemas/plan.ts`, `src/orchestrator/wave-runner.ts` -- existing implementation to extract from. HIGH confidence.
