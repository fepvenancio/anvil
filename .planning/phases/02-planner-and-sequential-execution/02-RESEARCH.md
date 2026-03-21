# Phase 2: Planner and Sequential Execution - Research

**Researched:** 2026-03-21
**Domain:** LLM-driven plan generation, git worktree isolation, sequential task execution
**Confidence:** HIGH

## Summary

Phase 2 transforms Anvil from a skeleton CLI into a functional build pipeline. It requires three major subsystems: (1) a Planner Station that calls Claude to decompose a natural-language spec into a validated JSON plan with touch maps and dependencies, (2) an interactive plan review prompt with $EDITOR integration, and (3) a sequential Worker executor that runs each task in an isolated git worktree with atomic commits and touch-map enforcement.

The critical integration point is the Anthropic SDK's structured output support. The SDK now provides `client.messages.parse()` with `zodOutputFormat()` from `@anthropic-ai/sdk/helpers/zod`, which accepts Zod schemas directly and returns type-safe parsed output. This eliminates the need for manual JSON parsing of LLM output and is the recommended approach for the Planner. For Workers, the interaction is simpler -- they receive a task spec and produce code; the structured output is the git diff, not JSON.

The highest risk is the Planner-Coder Gap (Pitfall #1 from research): plans that are too vague for Workers to implement correctly. The mitigation is a rich plan schema that includes explicit interface contracts, not just file lists. Since Phase 2 is sequential-only (no parallel waves), merge conflicts are impossible by construction, which simplifies the git worktree lifecycle significantly.

**Primary recommendation:** Use `@anthropic-ai/sdk` structured outputs with Zod schema for plan generation; build a thin WorktreeManager wrapping `simple-git` raw commands; enforce touch maps via post-execution `git diff --name-only` validation.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLI-01 | User can run `anvil run "spec"` to start a full build pipeline | Extend existing CLI `run` command to invoke Planner then Worker pipeline |
| PLAN-01 | Planner accepts natural-language spec, produces JSON plan with tasks, touch maps, dependency graph | Anthropic SDK structured outputs with `zodOutputFormat()` + PlanSchema |
| PLAN-02 | Each task declares `writes[]`, `reads[]`, `depends_on[]` | Already in TaskSchema from Phase 1; Planner must populate these fields |
| PLAN-03 | Plans with overlapping writes rejected; Planner re-plans or merges | Overlap detection in validator + re-prompt loop (max 3 retries) |
| PLAN-05 | Interactive prompt: "Review plan before starting execution? (Y/n/edit)" with $EDITOR support | Node.js readline + child_process.spawn for $EDITOR |
| EXEC-01 | Each task runs in its own git worktree on a dedicated branch | WorktreeManager with simple-git raw commands |
| EXEC-02 | Workers only read/write files declared in touch map | Post-execution git diff validation against writes[] |
| EXEC-03 | Every Worker change is an atomic git commit with descriptive message | simple-git commit in worktree, then merge to main |
</phase_requirements>

## Standard Stack

### Core (New for Phase 2)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/sdk | 0.80.0 | Claude API client for Planner and Worker | Official SDK. Supports `messages.parse()` with Zod via `zodOutputFormat()`. Structured outputs are GA (no beta header). |
| simple-git | 3.33.0 | Git worktree management, commits, merges | Standard Node.js git library. Worktree ops via `git.raw()`. Published 10 days ago. |

### Already Installed (Phase 1)

| Library | Version | Purpose |
|---------|---------|---------|
| zod | 4.3.6 | Plan schema validation, LLM output parsing |
| commander | 14.0.3 | CLI framework |
| chalk | 5.6.2 | Terminal colors |
| pino | 9.6.0 | Structured logging |

### No External Dependency Needed

| Capability | Use Instead |
|------------|-------------|
| Interactive prompt (Y/n/edit) | Node.js built-in `readline` + `node:child_process` for $EDITOR |
| UUID generation | `crypto.randomUUID()` (Node 22 built-in) |
| File watching (for $EDITOR re-validate) | `fs.stat()` mtime comparison (simpler than fs.watch) |

**Installation:**
```bash
npm install @anthropic-ai/sdk@^0.80.0 simple-git@^3.33.0
```

## Architecture Patterns

### Recommended Project Structure (Phase 2 additions)
```
src/
  cli.ts                    # Extended: run command invokes pipeline
  core/
    anvil-dir.ts            # Existing
    config-loader.ts        # Existing
    logger.ts               # Existing
    validator.ts            # Extended: overlap detection, dependency validation
  schemas/
    plan.ts                 # Existing (may need minor extension)
    ...                     # Existing schemas
  stations/
    planner.ts              # NEW: Planner Station (LLM call + schema parse)
  workers/
    worker.ts               # NEW: Single-task Worker (LLM call + file writes)
  git/
    worktree-manager.ts     # NEW: Worktree lifecycle (create/commit/merge/cleanup)
  orchestrator/
    sequential-runner.ts    # NEW: Runs tasks in order, manages worktree lifecycle
  prompts/
    planner-system.ts       # NEW: System prompt for Planner
    worker-system.ts        # NEW: System prompt for Worker
  ui/
    plan-review.ts          # NEW: Interactive Y/n/edit prompt
```

### Pattern 1: Planner Station with Structured Output

**What:** The Planner calls Claude with the user spec and a system prompt, using `messages.parse()` with the Zod PlanSchema to get a type-safe plan back.
**When:** Start of every `anvil run` invocation.
**Why:** Structured outputs guarantee valid JSON matching the schema. No manual parsing, no regex extraction.

```typescript
// Source: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PlanSchema } from '../schemas/plan.js';

const client = new Anthropic();

async function generatePlan(spec: string): Promise<Plan> {
  const response = await client.messages.parse({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16384,
    system: PLANNER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: spec }],
    output_config: { format: zodOutputFormat(PlanSchema) },
  });

  return response.parsed_output!;
}
```

### Pattern 2: WorktreeManager (Create/Work/Commit/Merge/Clean)

**What:** A thin class wrapping simple-git raw worktree commands with proper TypeScript types and error handling.
**When:** Every task execution creates a worktree; after completion, merge and cleanup.
**Why:** simple-git lacks native worktree methods. A dedicated manager ensures consistent lifecycle and crash recovery.

```typescript
import simpleGit, { SimpleGit } from 'simple-git';

class WorktreeManager {
  private git: SimpleGit;
  private baseDir: string;

  async create(taskId: string): Promise<{ worktreePath: string; branch: string }> {
    const branch = `anvil/task-${taskId}`;
    const worktreePath = join(this.baseDir, '.anvil', 'worktrees', `task-${taskId}`);
    await this.git.raw(['worktree', 'add', worktreePath, '-b', branch]);
    return { worktreePath, branch };
  }

  async commitAndMerge(taskId: string, message: string): Promise<void> {
    const { worktreePath, branch } = this.getWorktreeInfo(taskId);
    const worktreeGit = simpleGit(worktreePath);
    await worktreeGit.add('.');
    await worktreeGit.commit(message);
    // Merge back to main
    await this.git.merge([branch]);
  }

  async cleanup(taskId: string): Promise<void> {
    const worktreePath = this.getWorktreePath(taskId);
    await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
    // Delete the branch after merge
    const branch = `anvil/task-${taskId}`;
    await this.git.branch(['-d', branch]);
  }

  async pruneStale(): Promise<void> {
    await this.git.raw(['worktree', 'prune']);
  }
}
```

### Pattern 3: Touch Map Enforcement via Git Diff

**What:** After a Worker completes, check `git diff --name-only` in the worktree against the task's `writes[]` array. Reject if any file was modified outside the declared touch map.
**When:** After every Worker execution, before commit.
**Why:** Prevents Workers from writing files they were not authorized to touch. Simpler and more reliable than filesystem-level enforcement.

```typescript
async function validateTouchMap(worktreeGit: SimpleGit, writes: string[]): Promise<{
  valid: boolean;
  violations: string[];
}> {
  const diff = await worktreeGit.diff(['--name-only']);
  const untracked = await worktreeGit.raw(['ls-files', '--others', '--exclude-standard']);
  const allChanged = [...diff.split('\n'), ...untracked.split('\n')].filter(Boolean);
  const violations = allChanged.filter(f => !writes.includes(f));
  return { valid: violations.length === 0, violations };
}
```

### Pattern 4: Interactive Plan Review with $EDITOR

**What:** After plan generation, prompt user with "Review plan before starting execution? (Y/n/edit)". If 'edit', write plan to temp file, spawn $EDITOR, re-validate on return.
**When:** Between plan generation and execution.
**Why:** PLAN-05 requirement. Gives users control without breaking the single-command flow.

```typescript
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

async function promptPlanReview(plan: Plan): Promise<Plan> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>(resolve => {
    rl.question('Review plan before starting execution? (Y/n/edit) ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() === 'n') return plan;
  if (answer.toLowerCase() === 'edit') {
    return await editPlanInEditor(plan);
  }
  // 'Y' or Enter: display plan summary, then continue
  displayPlanSummary(plan);
  return plan;
}

async function editPlanInEditor(plan: Plan): Promise<Plan> {
  const tmpFile = join(tmpdir(), `anvil-plan-${crypto.randomUUID()}.json`);
  await writeFile(tmpFile, JSON.stringify(plan, null, 2));
  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, [tmpFile], { stdio: 'inherit' });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Editor exited with ${code}`)));
  });
  const edited = JSON.parse(await readFile(tmpFile, 'utf-8'));
  // Re-validate against schema
  const result = PlanSchema.safeParse(edited);
  if (!result.success) {
    console.error('Edited plan is invalid:', result.error.issues);
    throw new Error('Plan validation failed after edit');
  }
  return result.data;
}
```

### Pattern 5: Sequential Runner (Phase 2 Simplification)

**What:** Since Phase 2 is sequential-only, tasks execute one at a time in dependency order. No wave scheduling needed yet (Phase 3 adds that).
**When:** After plan is validated and user approves.
**Why:** Simplifies Phase 2 scope. Parallel execution comes in Phase 3.

```typescript
async function executeSequentially(plan: Plan, config: AnvilConfig): Promise<void> {
  const ordered = topologicalSort(plan.tasks);
  const worktreeManager = new WorktreeManager(process.cwd());
  await worktreeManager.pruneStale();

  for (const task of ordered) {
    const { worktreePath } = await worktreeManager.create(task.id);
    try {
      await executeTask(task, worktreePath, config);
      await worktreeManager.commitAndMerge(task.id, `feat: ${task.description}`);
    } finally {
      await worktreeManager.cleanup(task.id);
    }
  }
}
```

### Anti-Patterns to Avoid

- **Planner producing vague descriptions:** Task descriptions must include specific file paths, function signatures, and data shapes. The system prompt must demand this explicitly.
- **Workers deciding their own scope:** Workers receive a fixed task spec. If the plan is wrong, they should fail rather than improvise.
- **Parsing LLM output with regex:** Use structured outputs (`messages.parse()` + `zodOutputFormat()`). Never free-text parse.
- **Spawning $EDITOR with exec():** Use `spawn()` with `stdio: 'inherit'` so the editor gets the terminal. `exec()` buffers output and breaks interactive editors.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON schema for LLM output | Custom JSON parser with regex | `zodOutputFormat()` from `@anthropic-ai/sdk/helpers/zod` | Handles schema constraints, unsupported feature transformation, type safety |
| Git worktree commands | Direct `child_process.exec('git worktree ...')` | `simple-git` with `git.raw(['worktree', ...])` | Error handling, escaping, cross-platform paths |
| Topological sort | Custom graph traversal | Kahn's algorithm (~30 lines) | Simple enough to implement, no library needed. But do NOT skip cycle detection. |
| Plan overlap detection | Manual nested loop comparison | Set intersection on `writes[]` arrays | Straightforward but must be done for every pair of tasks within the same wave |
| UUID generation | uuid/nanoid library | `crypto.randomUUID()` | Built into Node 22 |

**Key insight:** The Anthropic SDK's `zodOutputFormat()` helper is the single most important "don't hand-roll" item. It transforms Zod schemas (including unsupported constraints like min/max) into valid JSON schemas with constraint info in descriptions. Without it, you'd need to maintain both a Zod schema and a separate JSON schema for the API.

## Common Pitfalls

### Pitfall 1: Planner-Coder Gap (Underspecified Plans)
**What goes wrong:** Planner produces tasks with vague descriptions. Workers misinterpret requirements and produce incompatible code.
**Why it happens:** LLMs decompose well at high level but struggle with precise contracts between components.
**How to avoid:** System prompt must demand: (a) explicit file paths in writes[]/reads[], (b) interface contracts for cross-task boundaries (function signatures, type shapes), (c) acceptance criteria that are mechanically verifiable.
**Warning signs:** Worker output compiles individually but breaks when integrated.

### Pitfall 2: Git Worktree Stale State on Crash
**What goes wrong:** If anvil crashes mid-task, worktrees and branches are left behind. Next run fails with "branch already checked out."
**Why it happens:** Worktree cleanup only happens in the happy path.
**How to avoid:** (1) Call `git worktree prune` at startup of every run, (2) Use try/finally for cleanup, (3) Register signal handlers (SIGINT/SIGTERM) to clean up before exit, (4) Use run-scoped branch names: `anvil/run-{uuid}/task-{id}`.
**Warning signs:** "fatal: branch already checked out" errors on second run.

### Pitfall 3: $EDITOR Spawn Blocks Forever
**What goes wrong:** $EDITOR is unset or set to a GUI editor that detaches. The spawn() promise never resolves.
**Why it happens:** GUI editors (VS Code with `--wait` flag, Sublime) fork and exit immediately. The child process exits but the editor window is still open.
**How to avoid:** Default to `vi` if $EDITOR is unset. Document that GUI editors need `--wait` flag (e.g., `export EDITOR="code --wait"`). Add a timeout (60 seconds) with a warning.
**Warning signs:** `anvil run` appears to hang after user selects "edit".

### Pitfall 4: Structured Output Schema Constraints
**What goes wrong:** Zod schema uses `min()`, `max()`, `regex()` etc. that are unsupported by Anthropic's JSON schema subset. The SDK helper transforms them to descriptions, but the LLM may not always respect description-based constraints.
**Why it happens:** Anthropic structured outputs support a subset of JSON Schema. Constraints like `minLength`, `maximum`, `pattern` are stripped and moved to descriptions.
**How to avoid:** Keep the PlanSchema simple for LLM output. Validate with full Zod schema AFTER parsing (two-pass: loose schema for LLM, strict schema for validation).
**Warning signs:** LLM returns empty arrays or strings that violate length constraints.

### Pitfall 5: Merge Conflicts in Sequential Mode
**What goes wrong:** Even in sequential mode, merging a worktree branch can conflict if the main branch was modified outside Anvil.
**Why it happens:** User might edit files manually while Anvil runs, or a previous task's merge changed a file that the current task also reads.
**How to avoid:** Always create worktrees from current HEAD. In sequential mode, each task's worktree starts from the merged result of all previous tasks. Use `--no-ff` merge to maintain clear history.
**Warning signs:** Merge failures that should be impossible in sequential mode.

### Pitfall 6: ESM Import Extension (.js) Gotcha
**What goes wrong:** TypeScript source uses `import { X } from './module'` without `.js` extension. Works with tsx but fails after build.
**Why it happens:** TypeScript with `module: "node16"` requires explicit `.js` extensions in import paths.
**How to avoid:** All imports must use `.js` extension. The Phase 1 codebase already follows this pattern. Ensure all new files continue the convention.
**Warning signs:** `ERR_MODULE_NOT_FOUND` after building with tsup.

## Code Examples

### Planner System Prompt Structure
```typescript
// The system prompt is critical for plan quality. It must demand specificity.
const PLANNER_SYSTEM_PROMPT = `You are the Planner for Anvil, an AI code factory.
Your job: decompose a user's spec into a concrete task list.

RULES:
1. Each task MUST declare writes[] (files to create/modify) and reads[] (files to read).
2. No two tasks may have overlapping writes[].
3. If Task A reads a file that Task B writes, Task A MUST list Task B in depends_on[].
4. Each task description MUST include:
   - Exact file paths
   - Function signatures for any exported functions
   - Data types for any shared interfaces
   - Acceptance criteria that are mechanically verifiable
5. Generate a unique ID for each task (e.g., "task-001").
6. The plan ID should be a UUID.

NEVER produce vague descriptions like "implement the API." Instead:
"Create src/routes/users.ts exporting GET /users (returns User[]) and POST /users (accepts CreateUserInput, returns User). User type: { id: string, name: string, email: string }."`;
```

### Worker System Prompt Structure
```typescript
const WORKER_SYSTEM_PROMPT = `You are a Worker for Anvil, an AI code factory.
You receive a single task and must implement it exactly as specified.

RULES:
1. Only create/modify files listed in writes[].
2. You may read files listed in reads[] for context.
3. Follow the task description precisely — do not expand scope.
4. If the task description is ambiguous or impossible, respond with an error explaining why.
5. Produce complete file contents for each file in writes[].
6. Every file must be valid, runnable code.

OUTPUT FORMAT:
For each file, output the complete file content.`;
```

### Overlap Detection in Validator
```typescript
export function detectWriteOverlaps(tasks: Task[]): Array<{
  taskA: string;
  taskB: string;
  overlappingFiles: string[];
}> {
  const overlaps: Array<{ taskA: string; taskB: string; overlappingFiles: string[] }> = [];
  for (let i = 0; i < tasks.length; i++) {
    const writesA = new Set(tasks[i].writes);
    for (let j = i + 1; j < tasks.length; j++) {
      const overlapping = tasks[j].writes.filter(f => writesA.has(f));
      if (overlapping.length > 0) {
        overlaps.push({
          taskA: tasks[i].id,
          taskB: tasks[j].id,
          overlappingFiles: overlapping,
        });
      }
    }
  }
  return overlaps;
}
```

### Topological Sort with Cycle Detection
```typescript
export function topologicalSort(tasks: Task[]): Task[] {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const inDegree = new Map(tasks.map(t => [t.id, 0]));
  const adjList = new Map<string, string[]>();

  for (const task of tasks) {
    adjList.set(task.id, []);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      adjList.get(dep)?.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: Task[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(taskMap.get(id)!);
    for (const neighbor of adjList.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== tasks.length) {
    const remaining = tasks.filter(t => !sorted.includes(t)).map(t => t.id);
    throw new Error(`Dependency cycle detected among tasks: ${remaining.join(', ')}`);
  }

  return sorted;
}
```

### Signal Handler for Worktree Cleanup
```typescript
function registerCleanupHandlers(worktreeManager: WorktreeManager, activeTaskIds: string[]): void {
  const cleanup = async () => {
    console.log('\nCleaning up worktrees...');
    for (const taskId of activeTaskIds) {
      try {
        await worktreeManager.cleanup(taskId);
      } catch {
        // Best effort on signal cleanup
      }
    }
    process.exit(1);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Tool-use hack for structured output | Native `output_config.format` with JSON schema | 2025 (GA) | No more tool-use workaround. Direct schema enforcement. |
| `output_format` parameter | `output_config.format` parameter | Late 2025 | Old param still works but new one is canonical |
| Manual JSON parsing of LLM output | `client.messages.parse()` + `zodOutputFormat()` | SDK 0.50+ | Type-safe parsed output, automatic schema transformation |
| Free-text plan descriptions | Structured outputs guarantee valid JSON | 2025 | Eliminates plan parsing failures entirely |

**Deprecated/outdated:**
- `output_format` parameter: Still works but `output_config.format` is the new canonical form
- Beta header for structured outputs: No longer needed, feature is GA

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.0 |
| Config file | implicit (vitest reads from package.json scripts) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-01 | `anvil run "spec"` invokes planner then executor | integration | `npx vitest run tests/integration/cli-run.test.ts -x` | Wave 0 |
| PLAN-01 | Planner produces valid plan from spec | unit (mocked LLM) | `npx vitest run tests/unit/planner.test.ts -x` | Wave 0 |
| PLAN-02 | Tasks declare writes/reads/dependsOn | unit | `npx vitest run tests/unit/plan-validation.test.ts -x` | Wave 0 |
| PLAN-03 | Overlapping writes rejected | unit | `npx vitest run tests/unit/overlap-detection.test.ts -x` | Wave 0 |
| PLAN-05 | Plan review prompt Y/n/edit | unit + manual | `npx vitest run tests/unit/plan-review.test.ts -x` | Wave 0 |
| EXEC-01 | Task runs in git worktree | integration | `npx vitest run tests/integration/worktree.test.ts -x` | Wave 0 |
| EXEC-02 | Touch map enforcement | unit | `npx vitest run tests/unit/touch-map.test.ts -x` | Wave 0 |
| EXEC-03 | Atomic git commits per task | integration | `npx vitest run tests/integration/worktree.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run && npx tsc --noEmit`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
- [ ] `tests/unit/planner.test.ts` -- covers PLAN-01, PLAN-02 (mock Anthropic client)
- [ ] `tests/unit/overlap-detection.test.ts` -- covers PLAN-03
- [ ] `tests/unit/plan-review.test.ts` -- covers PLAN-05 (mock stdin)
- [ ] `tests/unit/touch-map.test.ts` -- covers EXEC-02
- [ ] `tests/unit/topological-sort.test.ts` -- covers dependency ordering
- [ ] `tests/integration/worktree.test.ts` -- covers EXEC-01, EXEC-03 (real git in temp dir)
- [ ] `tests/integration/cli-run.test.ts` -- covers CLI-01 (mock LLM, real git)
- [ ] `vitest.config.ts` -- explicit config for test paths and timeouts
- [ ] Framework already installed: vitest 4.1.0 in devDependencies

## Open Questions

1. **Worker output format: tool_use vs. structured output vs. free text?**
   - What we know: Workers produce file contents, not JSON. Structured output works for JSON plans but may be awkward for multi-file code generation.
   - What's unclear: Best pattern for Workers to return multiple file contents in a structured way.
   - Recommendation: Use tool_use with a `write_file` tool (tool name, path, content) so Workers can "call" it multiple times. This is more natural for code generation than a single JSON blob.

2. **Re-planning loop: how many retries on overlap detection?**
   - What we know: PLAN-03 requires overlap rejection. Planner should re-plan.
   - What's unclear: How many retries before giving up.
   - Recommendation: 3 retries max. On the re-prompt, include the specific overlap violations so the LLM can fix them.

3. **Should Workers read actual file contents from disk?**
   - What we know: Workers need context from reads[] files. In sequential mode, previous tasks have already written their files.
   - What's unclear: Whether to pass file contents in the prompt or let the Worker "read" via tools.
   - Recommendation: For Phase 2 (sequential), read file contents from the worktree and include them in the prompt. This is simpler than tool-use for file reading and ensures the Worker sees the exact current state.

## Sources

### Primary (HIGH confidence)
- [Anthropic Structured Outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) - zodOutputFormat, messages.parse(), output_config.format
- [simple-git npm](https://www.npmjs.com/package/simple-git) - v3.33.0, raw worktree commands
- [Git worktree documentation](https://git-scm.com/docs/git-worktree) - official git worktree reference
- [Node.js readline API](https://nodejs.org/api/readline.html) - interactive prompt implementation

### Secondary (MEDIUM confidence)
- [Git Worktrees for Parallel AI Agents (Upsun)](https://devcenter.upsun.com/posts/git-worktrees-for-parallel-ai-coding-agents/) - worktree patterns for AI agents
- [Git Worktrees Complete Guide 2026](https://devtoolbox.dedyn.io/blog/git-worktrees-complete-guide) - lifecycle management patterns

### Tertiary (LOW confidence)
- [The Planner-Coder Gap (arxiv:2510.10460)](https://arxiv.org/abs/2510.10460) - 75.3% failure rate from underspecified plans (academic, may not directly map to our architecture)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versions verified against npm registry, SDK API verified against official docs
- Architecture: HIGH - patterns follow existing Phase 1 conventions, SDK usage verified
- Pitfalls: HIGH - backed by project research (PITFALLS.md) and official documentation
- Worktree lifecycle: MEDIUM - simple-git raw commands work but edge cases in crash recovery need integration testing

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable stack, 30-day validity)
