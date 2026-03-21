# Technology Stack: v1.1 Agent Backend

**Project:** Anvil - Worker Backend Delegation
**Researched:** 2026-03-21
**Scope:** NEW capabilities only (existing stack validated in prior milestones)

## Existing Stack (DO NOT CHANGE)

Already validated. Listed for integration context only:

| Technology | Version | Purpose |
|------------|---------|---------|
| TypeScript | ^5.8.0 | Language |
| @anthropic-ai/sdk | ^0.80.0 | Planner, High Court, Librarian (structured output) |
| commander | ^14.0.3 | CLI framework |
| simple-git | ^3.33.0 | Git/worktree management |
| zod | ^4.3.6 | Schema validation |
| p-limit | ^6.2.0 | Concurrency control |
| pino | ^9.6.0 | Logging |

## Recommended New Stack

### Primary: Claude Agent SDK (TypeScript)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @anthropic-ai/claude-agent-sdk | latest | Claude Code worker backend | Native TypeScript SDK. In-process async generator. Returns `SDKResultMessage` with `total_cost_usd`, `usage`, and `modelUsage` per-model breakdown. No subprocess management needed. Full tool control via `allowedTools`, `systemPrompt`, `permissionMode`, `maxTurns`, `maxBudgetUsd`. This is the correct integration path -- NOT subprocess spawning. |

**Confidence:** HIGH -- verified via official Anthropic Agent SDK TypeScript reference (platform.claude.com/docs/en/agent-sdk/typescript)

#### Why the Agent SDK, not `claude -p` subprocess

The Claude Code CLI (`claude -p --output-format json`) works for scripting but is inferior for Anvil's use case:

1. **Agent SDK is in-process.** `query()` returns an `AsyncGenerator<SDKMessage>` -- no subprocess, no stdio parsing, no exit code handling, no shell escaping.
2. **Structured cost reporting.** `SDKResultMessage` includes `total_cost_usd`, `usage: { input_tokens, output_tokens, cache_* }`, and `modelUsage: { [modelName]: { inputTokens, outputTokens, costUSD } }`. The CLI JSON output has similar data but requires JSON parsing of stdout.
3. **Programmatic tool control.** `allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep"]` with `permissionMode: "dontAsk"` (deny anything not pre-approved) or `"bypassPermissions"` (for trusted sandboxed execution).
4. **CWD scoping.** `cwd` option points the agent at the worktree path. It operates on files inside the worktree, inheriting Anvil's isolation model.
5. **Abort/budget control.** `AbortController` for cancellation, `maxTurns` and `maxBudgetUsd` for runaway protection.
6. **System prompt injection.** `systemPrompt` replaces the default, letting Anvil inject the Worker persona and task instructions.

#### Key API Surface

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: taskPromptString,
  options: {
    cwd: worktreePath,
    systemPrompt: WORKER_SYSTEM_PROMPT_FOR_CLAUDE_CODE,
    allowedTools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
    permissionMode: "bypassPermissions",      // or "dontAsk"
    allowDangerouslySkipPermissions: true,     // required for bypassPermissions
    maxTurns: 30,
    maxBudgetUsd: 2.00,
    model: config.model,
    settingSources: [],                         // isolation: no filesystem settings
    persistSession: false,                      // no session persistence needed
  }
});

// Stream messages, collect result
let result: SDKResultMessage;
for await (const message of q) {
  if (message.type === "result") {
    result = message;
  }
}

// result.total_cost_usd, result.usage, result.modelUsage available
```

#### SDKResultMessage Shape (verified)

```typescript
type SDKResultMessage = {
  type: "result";
  subtype: "success" | "error_max_turns" | "error_during_execution" | "error_max_budget_usd";
  session_id: string;
  duration_ms: number;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  modelUsage: {
    [modelName: string]: {
      inputTokens: number;
      outputTokens: number;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      costUSD: number;
    };
  };
  is_error: boolean;
  errors?: string[];  // present on error subtypes
};
```

### Secondary: Raw SDK Adapter (existing `@anthropic-ai/sdk`)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @anthropic-ai/sdk | ^0.80.0 (already installed) | Fallback/legacy "sdk" backend | Preserves v1 behavior exactly. Single API call, custom tool loop, manual file I/O. No new dependency. Useful when users want minimal overhead or have API-key-only access without Claude Code installed. |

This is the current `executeTask()` in `src/workers/worker.ts`. Wrap it as the `sdk` adapter with zero changes.

### Future/Deferred: Cursor CLI Adapter

| Technology | Status | Interface | Why Defer |
|------------|--------|-----------|-----------|
| Cursor CLI | Beta (March 2026) | `cursor agent -p -m "prompt" --output-format json --force` | Viable but immature. Requires `CURSOR_API_KEY` env var. `--force` flag needed for actual file writes (without it, changes are only proposed). No documented token usage in output. stream-json events have `tool_call` tracking but no cost/usage fields. Headless mode has [known hanging issues](https://forum.cursor.com/t/cursor-agent-p-print-headless-mode-hangs-indefinitely-and-never-returns/150246). Defer to v1.2. |

**Confidence:** MEDIUM -- Cursor docs verified at cursor.com/docs/cli/headless, but the tool is explicitly beta and the API surface is still shifting.

#### Cursor Integration Notes (for future reference)

- Install: `curl -fsSL https://cursor.com/install-cli | sh`
- Auth: `CURSOR_API_KEY` environment variable
- Invocation: `cursor agent -p -m "<prompt>" --output-format json --force`
- Output: NDJSON stream with `system`, `assistant`, `tool_call`, `result` events
- Result event includes `duration_ms` but NOT token usage
- Requires `--force` or `--yolo` for actual file modifications
- No system prompt override flag documented

### Future/Deferred: Aider Adapter

| Technology | Status | Interface | Why Defer |
|------------|--------|-----------|-----------|
| Aider | Stable CLI, unstable scripting API | `aider -m "prompt" --yes-always --no-auto-commits --file f1 --file f2` | Python dependency (violates pure-TS constraint). No JSON output mode. No structured token/cost reporting to stdout. Exit codes undocumented. The Python scripting API (`from aider.coders import Coder`) is explicitly "not officially supported or documented, and could change." Would require subprocess + stdout scraping. Defer indefinitely or until aider adds `--output-format json`. |

**Confidence:** HIGH that this should be deferred -- verified at aider.chat/docs/scripting.html and aider.chat/docs/config/options.html. The tool is designed for interactive use.

## Adapter Interface Design

No new library needed. This is a pure TypeScript interface:

```typescript
interface AgentAdapter {
  readonly name: string;

  execute(params: {
    task: Task;
    worktreePath: string;
    config: AnvilConfig;
    signal?: AbortSignal;
  }): Promise<WorkerResult>;
}
```

`WorkerResult` already exists in `src/workers/worker.ts` with the right shape:

```typescript
interface WorkerResult {
  taskId: string;
  success: boolean;
  filesWritten: string[];
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
}
```

Extend with optional cost field:

```typescript
interface WorkerResult {
  // ... existing fields ...
  costUsd?: number;  // NEW: total cost from Agent SDK
}
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Claude Code integration | Agent SDK (`@anthropic-ai/claude-agent-sdk`) | CLI subprocess (`claude -p`) | SDK is in-process, typed, no shell escaping, no stdout parsing. CLI is a wrapper around the same engine. |
| Claude Code integration | Agent SDK | `@anthropic-ai/claude-code` npm package | This package is deprecated/renamed to `@anthropic-ai/claude-agent-sdk`. |
| Process management lib | None (use Agent SDK directly) | execa, tinyexec | Only needed for subprocess CLIs. Agent SDK is in-process. The `sdk` adapter uses the existing Anthropic SDK directly. No subprocess for either default backend. |
| Multi-CLI orchestrator | Custom adapter interface | MCO (github.com/mco-org/mco) | MCO is an orchestration layer itself -- would conflict with Anvil's orchestrator. Anvil IS the orchestrator. |

## What NOT to Add

| Library | Reason to Skip |
|---------|----------------|
| `execa` / `tinyexec` / `cross-spawn` | No subprocess needed for the two v1.1 adapters. Agent SDK is in-process, raw SDK is already a dependency. If Cursor adapter lands in v1.2, Node.js built-in `child_process.spawn` is sufficient for a single CLI call. |
| `tree-kill` | Already in node_modules (vitest dep). Only needed if subprocess management is added later. |
| Docker/container libs | Explicitly out of scope per project constraints. |
| Python / pip / venv tooling | Explicitly out of scope. Rules out Aider as a v1.1 backend. |
| `@anthropic-ai/claude-code` | Deprecated. Use `@anthropic-ai/claude-agent-sdk` instead. |

## Installation

```bash
# Single new dependency for v1.1
npm install @anthropic-ai/claude-agent-sdk
```

No dev dependency changes needed.

## Integration Points with Existing Architecture

### Worker Execution Flow (current -> new)

**Current** (`src/workers/worker.ts`):
1. Build prompt from Task
2. Call `client.messages.create()` with WORKER_TOOLS
3. Parse tool_use blocks, write files manually
4. Validate touch map
5. Return WorkerResult

**New** (with adapter pattern):
1. `wave-runner.ts` selects adapter based on `config.agent` (from `--agent` flag)
2. Adapter receives Task + worktreePath
3. **Claude Code adapter**: calls Agent SDK `query()`, agent reads/writes files directly in worktree via its built-in tools, returns SDKResultMessage with cost
4. **SDK adapter**: runs current `executeTask()` logic unchanged
5. Both return `WorkerResult` with usage data
6. Touch map validation runs AFTER adapter completes (git diff on worktree)

### Key Architectural Difference

The Claude Code adapter does NOT use custom `write_file` / `report_error` tools. Instead, Claude Code has built-in `Read`, `Edit`, `Write`, `Bash`, `Glob`, `Grep` tools that operate on real files. The adapter:
- Sets `cwd` to the worktree path
- Lets Claude Code agent loop handle file operations natively
- Validates touch map post-execution via git diff (existing `validateTouchMap`)
- Extracts `filesWritten` from git status in the worktree

### Config Schema Addition

```typescript
// In src/schemas/config.ts
agent: z.enum(["claude-code", "sdk"]).default("claude-code")
```

### CLI Flag Addition

```typescript
// In src/cli.ts
.option("--agent <backend>", "Worker backend: claude-code (default) or sdk", "claude-code")
```

## Agent Capability Comparison

| Capability | Claude Code (Agent SDK) | Raw SDK |
|------------|------------------------|---------|
| File read | Built-in Read tool | Manual via prompt injection |
| File write | Built-in Edit/Write tools | Custom write_file tool_use |
| Run commands | Built-in Bash tool | Not available |
| Multi-turn reasoning | Full agent loop (multiple turns) | Single API call |
| Error recovery | Agent retries, self-corrects | Caller must retry |
| Token usage | SDKResultMessage.usage | response.usage |
| Cost tracking | SDKResultMessage.total_cost_usd | Manual calculation from usage |
| Touch map enforcement | Post-hoc via git diff | Pre-validated via writes[] check |
| Max budget | maxBudgetUsd option | Manual token counting |
| Abort | AbortController | AbortController on API call |

## Sources

- [Claude Code headless/programmatic docs](https://code.claude.com/docs/en/headless) -- Confirmed Agent SDK is the recommended path, `-p` flag is CLI wrapper
- [Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- Full API: query(), Options, SDKResultMessage with usage/cost fields
- [Agent SDK quickstart](https://platform.claude.com/docs/en/agent-sdk/quickstart) -- Installation, basic usage, permission modes
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) -- Package exists, actively maintained
- [Cursor CLI headless docs](https://cursor.com/docs/cli/headless) -- Beta status, --force flag, NDJSON output, no token reporting
- [Cursor headless hanging bug report](https://forum.cursor.com/t/cursor-agent-p-print-headless-mode-hangs-indefinitely-and-never-returns/150246) -- Known reliability issue
- [Aider scripting docs](https://aider.chat/docs/scripting.html) -- --message flag, Python API "not officially supported"
- [Aider options reference](https://aider.chat/docs/config/options.html) -- --yes-always, --no-auto-commits, no JSON output
