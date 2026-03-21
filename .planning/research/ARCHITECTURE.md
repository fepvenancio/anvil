# Architecture Patterns: Configurable Agent Backends

**Domain:** AI agent orchestration with pluggable execution backends
**Researched:** 2026-03-21
**Supplements:** Original ARCHITECTURE.md (2026-03-20) -- this document covers the v1.1 Agent Backend milestone specifically.

## Recommended Architecture

The adapter pattern inserts a thin abstraction layer between the wave-runner/sequential-runner orchestrators and the concrete AI execution mechanism. The current `executeTask()` function in `src/workers/worker.ts` becomes one of two adapter implementations behind a common `AgentAdapter` interface.

### Key Design Insight: Two Fundamentally Different Execution Models

The SDK adapter and the Claude Code adapter are not just "different ways to call Claude." They represent two fundamentally different execution models:

| Concern | SDK Adapter | Claude Code Adapter |
|---------|-------------|---------------------|
| **File I/O** | Anvil reads files, injects into prompt, parses tool_use blocks, writes files itself | Claude Code reads/writes files directly in the worktree via its own tools |
| **Iteration** | Single-shot: one API call, parse response | Multi-turn: Claude Code runs tests, reads errors, retries autonomously |
| **Touch map enforcement** | Post-hoc validation via `validateTouchMap()` | Pre-configured via `--allowedTools` restricting Write/Edit to declared paths, PLUS post-hoc validation |
| **Error recovery** | None (report_error tool) | Built-in (Claude Code retries on failure) |
| **Cost tracking** | Token counts from `response.usage` | `total_cost_usd` and `usage` from `SDKResultMessage` |
| **Git behavior** | Anvil commits after task | Claude Code must NOT commit (Anvil owns git) |

This asymmetry means the adapter interface must be minimal -- it cannot assume either model.

### Component Boundaries

```
cli.ts
  |
  +---> config (--agent flag) ---> resolveAdapter()
  |
  +---> planner.ts (always SDK -- needs structured output via zodOutputFormat)
  |
  +---> wave-runner.ts / sequential-runner.ts
          |
          +---> WorktreeManager.create(taskId) --> worktreePath
          |
          +---> adapter.execute(task, worktreePath, config) --> AdapterResult
          |
          +---> validateTouchMap(worktreePath, task.writes)  [defense-in-depth]
          |
          +---> costTracker.recordFromAdapter(result.usage)
          |
          +---> WorktreeManager.commitInWorktree(taskId, msg)
```

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `AgentAdapter` (interface) | Define execution contract | wave-runner, sequential-runner |
| `SdkAdapter` | Execute tasks via raw Anthropic SDK (current behavior extracted from worker.ts) | Anthropic SDK, filesystem |
| `ClaudeCodeAdapter` | Execute tasks via `@anthropic-ai/claude-agent-sdk` `query()` | Agent SDK subprocess, worktree filesystem |
| `resolveAdapter()` | Factory: config string -> adapter instance | Config, adapter constructors |
| `AgentCapabilities` | Declare what an adapter can do (data object, not methods) | Planner (for task generation) |
| Updated `AnvilConfig` | Carry `agent` field | CLI, all adapters |

## Adapter Interface Contract

```typescript
// src/adapters/types.ts

import type { Task } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';

export interface AdapterUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd?: number;          // Claude Code provides this directly
  model: string;
}

export interface AdapterResult {
  taskId: string;
  success: boolean;
  filesWritten: string[];
  error?: string;
  usage: AdapterUsage;
}

export interface AgentCapabilities {
  /** Agent can read files from the worktree on its own */
  canReadFiles: boolean;
  /** Agent can iterate (run tests, fix errors, retry) */
  canIterate: boolean;
  /** Agent can execute shell commands */
  canRunCommands: boolean;
  /** Agent can explore the codebase beyond declared reads[] */
  canExploreCodebase: boolean;
}

export interface AgentAdapter {
  /** Human-readable name for logging */
  readonly name: string;

  /** What this adapter can do -- informs the Planner */
  readonly capabilities: AgentCapabilities;

  /**
   * Execute a single task in the given worktree directory.
   *
   * Contract:
   * - Adapter MUST write files to worktreePath
   * - Adapter MUST NOT make git commits
   * - Adapter MUST NOT modify files outside task.writes[]
   * - Adapter MUST return token usage for cost tracking
   * - Adapter SHOULD respect task.acceptanceCriteria
   */
  execute(
    task: Task,
    worktreePath: string,
    config: AnvilConfig,
  ): Promise<AdapterResult>;
}
```

**Confidence: HIGH** -- This interface is derived directly from the existing `WorkerResult` type and `executeTask()` signature in the codebase. The contract preserves all invariants the orchestrators depend on.

## SDK Adapter Implementation

Refactored from existing `src/workers/worker.ts`. The logic is identical -- only the wrapping changes.

```typescript
// src/adapters/sdk-adapter.ts

export class SdkAdapter implements AgentAdapter {
  readonly name = 'sdk';
  readonly capabilities: AgentCapabilities = {
    canReadFiles: false,      // Anvil injects file contents into prompt
    canIterate: false,        // Single API call, no retry loop
    canRunCommands: false,    // No shell access
    canExploreCodebase: false,
  };

  private client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async execute(task: Task, worktreePath: string, config: AnvilConfig): Promise<AdapterResult> {
    // Move existing executeTask() body here verbatim:
    // 1. Build user message with task details + read context
    // 2. Call client.messages.create() with WORKER_SYSTEM_PROMPT + WORKER_TOOLS
    // 3. Parse tool_use blocks (write_file, report_error)
    // 4. Write files to worktreePath
    // 5. Return AdapterResult with usage from response.usage
  }
}
```

## Claude Code Adapter Implementation

Uses `@anthropic-ai/claude-agent-sdk` TypeScript package. The `query()` function spawns a Claude Code subprocess with full tool access, constrained to the worktree.

```typescript
// src/adapters/claude-code-adapter.ts

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentAdapter, AdapterResult, AgentCapabilities } from './types.js';
import type { Task } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';

const CLAUDE_CODE_WORKER_PROMPT = `You are a Worker for Anvil, an AI code factory.
You receive a single task and must implement it exactly as specified.

RULES:
1. Only create or modify files listed in the task's writes[] array.
2. Read the context files listed in reads[] before starting.
3. Follow the task description precisely -- do not expand scope.
4. Run relevant tests or type checks to verify your work before finishing.
5. If the task is ambiguous or impossible, explain why in your final response.
6. Do NOT make git commits -- Anvil manages git.`;

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly name = 'claude-code';
  readonly capabilities: AgentCapabilities = {
    canReadFiles: true,
    canIterate: true,
    canRunCommands: true,
    canExploreCodebase: true,
  };

  async execute(task: Task, worktreePath: string, config: AnvilConfig): Promise<AdapterResult> {
    const prompt = this.buildPrompt(task);

    const conversation = query({
      prompt,
      options: {
        cwd: worktreePath,
        systemPrompt: CLAUDE_CODE_WORKER_PROMPT,
        model: config.model,
        allowedTools: this.buildAllowedTools(task),
        disallowedTools: ['Bash(git *)'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 25,
        maxBudgetUsd: 2.00,
        persistSession: false,
      },
    });

    let finalResult: AdapterResult | undefined;

    for await (const message of conversation) {
      if (message.type === 'result') {
        const usage = {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
          costUsd: message.total_cost_usd,
          model: config.model,
        };

        if (message.subtype === 'success') {
          finalResult = {
            taskId: task.id,
            success: true,
            filesWritten: task.writes,
            usage,
          };
        } else {
          finalResult = {
            taskId: task.id,
            success: false,
            filesWritten: [],
            error: ('errors' in message ? message.errors?.join('; ') : message.subtype) ?? 'unknown',
            usage,
          };
        }
      }
    }

    return finalResult ?? {
      taskId: task.id,
      success: false,
      filesWritten: [],
      error: 'No result message received from Claude Code',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: config.model },
    };
  }

  private buildAllowedTools(task: Task): string[] {
    const tools = ['Read', 'Glob', 'Grep'];
    for (const file of task.writes) {
      tools.push(`Write(${file})`);
      tools.push(`Edit(${file})`);
    }
    // Allow Bash for tests/linting but not git
    tools.push('Bash(npm *)');
    tools.push('Bash(npx *)');
    tools.push('Bash(node *)');
    tools.push('Bash(cat *)');
    tools.push('Bash(ls *)');
    return tools;
  }

  private buildPrompt(task: Task): string {
    // Leaner than SDK prompt -- Claude Code can read files itself
    return [
      `## Task: ${task.description}`,
      ``,
      `### Files to create/modify:`,
      ...task.writes.map(f => `- ${f}`),
      ``,
      `### Files to read for context:`,
      ...task.reads.map(f => `- ${f}`),
      ``,
      `### Acceptance Criteria:`,
      ...task.acceptanceCriteria.map(c => `- ${c}`),
      ``,
      `Read the context files first, then implement. Run any relevant tests to verify your work.`,
    ].join('\n');
  }
}
```

**Confidence: HIGH** -- The `query()` API, Options type, and SDKResultMessage structure are documented in the official [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript). Key fields verified: `cwd`, `systemPrompt`, `allowedTools`, `disallowedTools`, `permissionMode`, `maxTurns`, `maxBudgetUsd`, `persistSession`, and result message `usage`/`total_cost_usd`.

## Adapter Factory

```typescript
// src/adapters/index.ts

import type { AgentAdapter } from './types.js';
import { SdkAdapter } from './sdk-adapter.js';
import { ClaudeCodeAdapter } from './claude-code-adapter.js';
import type Anthropic from '@anthropic-ai/sdk';

export type AgentBackend = 'claude-code' | 'sdk';

export function resolveAdapter(backend: AgentBackend, client?: Anthropic): AgentAdapter {
  switch (backend) {
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'sdk':
      return new SdkAdapter(client);
    default:
      throw new Error(`Unknown agent backend: ${backend}. Use 'claude-code' or 'sdk'.`);
  }
}

export type { AgentAdapter, AdapterResult, AdapterUsage, AgentCapabilities } from './types.js';
```

## Integration Points with Existing Code

### 1. Config Schema Change (`src/schemas/config.ts`)

```typescript
export const AnvilConfigSchema = z.object({
  projectName: z.string().default('anvil-project'),
  model: z.string().default('claude-sonnet-4-20250514'),
  maxWorkers: z.number().int().min(1).max(16).default(4),
  anvilDir: z.string().default('.anvil'),
  agent: z.enum(['claude-code', 'sdk']).default('claude-code'),  // NEW
});
```

### 2. CLI Flag Addition (`src/cli.ts`)

```typescript
.option('-a, --agent <backend>', 'Agent backend: claude-code (default) or sdk', 'claude-code')
```

The `loadConfig()` function in `src/core/config-loader.ts` will need to pass through the `agent` option.

### 3. Wave Runner Changes (`src/orchestrator/wave-runner.ts`)

Current call site (line 93):
```typescript
const result = await executeTask(task, worktreePath, config, {
  client: options?.client,
});
```

New call site:
```typescript
const result = await adapter.execute(task, worktreePath, config);
```

The `executeInWaves` function signature gains an `adapter` option:
```typescript
export async function executeInWaves(
  plan: Plan,
  config: AnvilConfig,
  options?: {
    adapter?: AgentAdapter;    // NEW
    costTracker?: CostTracker;
    progress?: ProgressDisplay;
    baseDir?: string;
  },
): Promise<WaveExecutionResult> {
  const adapter = options?.adapter ?? resolveAdapter(config.agent);
  // ...
}
```

**Critical:** The `validateTouchMap()` call (line 77 in current worker.ts) moves OUT of the worker and INTO the orchestrator, running AFTER `adapter.execute()` returns. This ensures touch map validation is adapter-agnostic.

### 4. Sequential Runner Changes (`src/orchestrator/sequential-runner.ts`)

Same pattern as wave-runner: accept adapter via options, delegate to it.

### 5. Cost Tracker Integration (`src/cost/tracker.ts`)

Add a method that accepts the adapter's unified usage format:

```typescript
recordFromAdapter(
  usage: AdapterUsage,
  agent: string,
  waveNumber?: number,
): void {
  this.record({
    agent,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    model: usage.model,
    waveNumber,
  });
}
```

The existing `recordFromResponse()` method stays for Planner/High Court/Librarian (which remain on raw SDK).

### 6. Planner Stays on SDK

The Planner (`src/stations/planner.ts`) uses `zodOutputFormat(PlanSchema)` for structured output. This requires the raw Anthropic SDK's `messages.parse()` method. The Planner MUST NOT use the adapter system -- it is not a "worker" and needs guaranteed JSON schema output.

Same for High Court (`src/judges/high-court.ts`) and Librarian (`src/stations/librarian.ts`) -- they need structured output guarantees.

### 7. Touch Map Enforcement -- Two Layers for Claude Code

For the SDK adapter, touch map works exactly as today (post-hoc git diff check via `validateTouchMap()`).

For the Claude Code adapter, enforcement operates at TWO layers:
1. **Pre-execution:** `allowedTools` in the Agent SDK options restricts Write/Edit to declared file paths
2. **Post-execution:** `validateTouchMap()` still runs in the orchestrator

This dual enforcement means Claude Code tasks are actually MORE constrained than SDK tasks. The `allowedTools` approach uses Claude Code's [permission rule syntax](https://code.claude.com/docs/en/settings#permission-rule-syntax) where `Write(path)` restricts writes to that specific path.

## Capability-Aware Planning

### The Problem

The Planner currently generates tasks assuming a dumb executor: it specifies exact function signatures, data types, and file contents because the SDK worker gets ONE shot with no ability to iterate. But Claude Code workers can read files, run tests, and fix mistakes autonomously.

### The Solution: Capability-Injected Planner Prompt

The Planner's system prompt gains a dynamic section describing the worker's capabilities. This is injected at plan-generation time based on the selected adapter.

```typescript
// src/prompts/planner-system.ts -- add capability section builder

export function buildCapabilitySection(capabilities: AgentCapabilities): string {
  const lines: string[] = ['\nWORKER CAPABILITIES:'];

  if (capabilities.canIterate) {
    lines.push('- Workers CAN run tests and fix errors autonomously.');
    lines.push('- Focus descriptions on WHAT to build and WHY, not exact code.');
    lines.push('- Acceptance criteria SHOULD include runnable commands (e.g., "npm test passes").');
  } else {
    lines.push('- Workers execute in a SINGLE PASS with no ability to test or retry.');
    lines.push('- Descriptions MUST include exact function signatures, types, and structure.');
    lines.push('- Acceptance criteria should be structural, not behavioral.');
  }

  if (capabilities.canReadFiles) {
    lines.push('- Workers CAN read any file in the project. reads[] is a hint, not a restriction.');
  } else {
    lines.push('- Workers can ONLY see files listed in reads[]. All context must be declared.');
  }

  if (capabilities.canRunCommands) {
    lines.push('- Workers CAN run shell commands (npm test, npx tsc, etc.).');
  }

  return lines.join('\n');
}
```

This means the same Planner produces DIFFERENT plans based on the selected backend:

| Aspect | SDK Plan | Claude Code Plan |
|--------|----------|------------------|
| Task descriptions | Verbose: exact signatures, types, code structure | Concise: what to build, acceptance criteria |
| reads[] | Exhaustive: every file the worker needs | Minimal: key starting points |
| acceptanceCriteria | Structural: "exports function X with signature Y" | Behavioral: "npm test passes", "npx tsc --noEmit succeeds" |
| Task granularity | Fine: 1-2 files per task | Coarser: 3-5 files per task feasible |

### Planner Integration Point

```typescript
// src/stations/planner.ts -- inject capabilities into system prompt
export async function generatePlan(
  spec: string,
  config: AnvilConfig,
  options?: GeneratePlanOptions & { capabilities?: AgentCapabilities },
): Promise<Plan> {
  const systemPrompt = options?.capabilities
    ? PLANNER_SYSTEM_PROMPT + '\n\n' + buildCapabilitySection(options.capabilities)
    : PLANNER_SYSTEM_PROMPT;
  // Pass systemPrompt through to _generateWithRetry
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Adapter Owns Git
**What:** Letting adapters make commits or manage branches.
**Why bad:** Breaks worktree isolation model. Wave-runner needs deterministic merge ordering. If Claude Code auto-commits, the worktree branch may have multiple commits that conflict with Anvil's single-commit-per-task model.
**Instead:** Adapters write files only. `disallowedTools: ['Bash(git *)']` prevents Claude Code from touching git. Orchestrator handles all git operations.

### Anti-Pattern 2: Adapter Validates Touch Map
**What:** Moving touch map validation into the adapter.
**Why bad:** Each adapter would need its own validation logic. Claude Code's `allowedTools` is necessary but not sufficient (files could be created by Bash commands that bypass Write/Edit tool restrictions).
**Instead:** Keep `validateTouchMap()` in the orchestrator as defense-in-depth. Always runs after adapter returns.

### Anti-Pattern 3: Fat Adapter Interface
**What:** Adding methods like `readFile()`, `runTest()`, `lint()` to the adapter.
**Why bad:** Only Claude Code has these capabilities. SDK adapter would need stubs. Violates Interface Segregation.
**Instead:** Single `execute()` method. Capabilities are DECLARED as data, not exposed as methods.

### Anti-Pattern 4: Planner Queries Adapter at Runtime
**What:** Planner calling adapter methods during plan generation.
**Why bad:** Creates coupling between Planner and adapter. Planner runs before adapters are needed.
**Instead:** Pass `AgentCapabilities` (a plain data object) to the Planner at generation time.

### Anti-Pattern 5: Claude Code Worker Uses Interactive Mode or Raw CLI
**What:** Spawning `claude -p` as a raw subprocess instead of using the TypeScript Agent SDK.
**Why bad:** Requires parsing CLI output. No type safety. Harder to get structured usage data. The Agent SDK `query()` function exists specifically for programmatic usage and returns typed `SDKMessage` objects.
**Instead:** Use `@anthropic-ai/claude-agent-sdk` `query()` function.

## Patterns to Follow

### Pattern 1: Strategy via Constructor Injection
**What:** Wave-runner receives an adapter via its options parameter, not via global lookup.
**When:** Always. Enables testing with mock adapters.
```typescript
export async function executeInWaves(
  plan: Plan,
  config: AnvilConfig,
  options?: { adapter?: AgentAdapter; ... },
): Promise<WaveExecutionResult> {
  const adapter = options?.adapter ?? resolveAdapter(config.agent);
}
```

### Pattern 2: Unified Result Type
**What:** Both adapters return `AdapterResult` with the same shape.
**When:** Always. Decouples orchestrator from adapter internals.

### Pattern 3: Defense-in-Depth Validation
**What:** Touch map validation runs AFTER adapter returns, regardless of adapter type.
**When:** Every task execution. Claude Code's `allowedTools` is a first line; `validateTouchMap()` is the authoritative check.

### Pattern 4: Capability Declaration as Data
**What:** Capabilities are a readonly plain object, not methods or runtime checks.
**When:** Passing capability info to the Planner. Used for prompt injection, never for runtime branching in the orchestrator.

## File Structure

```
src/
  adapters/
    types.ts                # AgentAdapter, AdapterResult, AdapterUsage, AgentCapabilities
    sdk-adapter.ts          # SdkAdapter (refactored from worker.ts)
    claude-code-adapter.ts  # ClaudeCodeAdapter (new)
    index.ts                # resolveAdapter() factory, re-exports
  workers/
    worker.ts               # Becomes thin re-export or deprecated
  prompts/
    worker-system.ts        # SDK worker prompt (unchanged, used by SdkAdapter)
    planner-system.ts       # + buildCapabilitySection() export
  schemas/
    config.ts               # + agent field
  cost/
    tracker.ts              # + recordFromAdapter() method
  orchestrator/
    wave-runner.ts          # + adapter parameter, touch map moves here
    sequential-runner.ts    # + adapter parameter
```

## Suggested Build Order

Each step is independently testable. Build order respects dependency chain.

### Step 1: Adapter Interface + Types
Create `src/adapters/types.ts`. Pure type definitions, no runtime code. No dependencies.

### Step 2: SDK Adapter (Extract from worker.ts)
Move `executeTask()` logic from `src/workers/worker.ts` into `SdkAdapter.execute()`. Keep `worker.ts` as a thin wrapper that delegates to `SdkAdapter` for backward compatibility. All existing tests pass unchanged.

### Step 3: Wire Adapter into Orchestrators
Update `wave-runner.ts` and `sequential-runner.ts` to accept `AgentAdapter` via options. Default to `new SdkAdapter()`. Move `validateTouchMap()` call from worker into orchestrator (it currently lives in `executeTask()`). Existing behavior is identical.

### Step 4: Config + CLI Flag
Add `agent` field to `AnvilConfigSchema`. Add `--agent` flag to CLI. Add `resolveAdapter()` factory in `src/adapters/index.ts`. Wire through `loadConfig()`.

### Step 5: Cost Tracker Update
Add `recordFromAdapter()` method to `CostTracker`. Update orchestrators to use it instead of directly calling `recordFromResponse()` with SDK-specific shapes.

### Step 6: Claude Code Adapter
Implement `ClaudeCodeAdapter`. Add `@anthropic-ai/claude-agent-sdk` as dependency. This is the first step requiring a new npm package.

### Step 7: Capability-Aware Planner
Add `buildCapabilitySection()` to `src/prompts/planner-system.ts`. Update `generatePlan()` signature to accept optional `capabilities`. Wire adapter capabilities through CLI -> planner.

### Step 8: Integration Testing
End-to-end: select `--agent claude-code`, plan generates capability-appropriate tasks, Claude Code executes in worktree, touch map validates, wave merges correctly, cost tracked.

## Scalability Considerations

| Concern | 1-4 workers | 8-16 workers | Future: other CLI agents |
|---------|-------------|--------------|--------------------------|
| Process spawning | Agent SDK manages one subprocess per `query()` call | May hit OS process limits; `maxWorkers` config already exists as throttle | Same pattern -- each adapter manages its own processes |
| Memory | ~100-150MB per Claude Code subprocess | ~800MB-2GB total | Monitor per-adapter memory footprint |
| Cost tracking | Each `AdapterResult` reports usage independently | Same -- CostTracker aggregates | Adapter contract requires usage in result |
| Adding new backends | N/A | N/A | Implement `AgentAdapter` interface, add case to `resolveAdapter()`, declare capabilities |

## Sources

- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference) -- Official CLI flags including `--allowedTools`, `--disallowedTools`, permission rule syntax -- HIGH confidence
- [Run Claude Code Programmatically (Agent SDK)](https://code.claude.com/docs/en/headless) -- Agent SDK overview, `-p` mode, subprocess model -- HIGH confidence
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- `query()` API, `Options` type (cwd, systemPrompt, allowedTools, permissionMode, maxTurns, maxBudgetUsd, persistSession), `SDKResultMessage` (usage, total_cost_usd, modelUsage), `SDKMessage` union type -- HIGH confidence
- [@anthropic-ai/claude-agent-sdk on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) -- Package exists and is installable -- HIGH confidence
- Existing Anvil source code: `src/workers/worker.ts`, `src/orchestrator/wave-runner.ts`, `src/orchestrator/sequential-runner.ts`, `src/cost/tracker.ts`, `src/schemas/config.ts`, `src/stations/planner.ts` -- PRIMARY source for integration points
