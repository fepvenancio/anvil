# Pitfalls Research: Configurable CLI Agent Backends

**Domain:** Adding CLI agent delegation to an existing AI orchestrator
**Project:** Anvil v1.1 -- Agent Backend milestone
**Researched:** 2026-03-21
**Confidence:** HIGH

This document covers pitfalls specific to replacing Anvil's direct Anthropic SDK worker calls with configurable CLI agent backends (Claude Code CLI, OpenAI Codex CLI, etc.). It does NOT repeat the general orchestration pitfalls from the v1.0 research -- those remain valid and additive.

---

## Critical Pitfalls

### Pitfall 1: Touch-Map Bypass -- CLI Agents Have Unrestricted File Access

**What goes wrong:**
Anvil's current touch-map enforcement works because Workers write files through a controlled `write_file` tool call, and the orchestrator validates `git diff --name-only` against the declared `writes[]` list after execution. When you switch to a CLI agent (Claude Code, Codex), the agent has full filesystem access inside the worktree. It can read any file, write any file, create directories, run shell commands, install packages, and modify `.gitignore` -- all without the orchestrator knowing until after the fact.

The current `validateTouchMap()` in `worktree-manager.ts` runs `git diff --name-only` post-execution, which catches violations but only AFTER the agent has already done the work and burned the tokens. Worse, a clever agent might modify a file and then revert it, leaving no trace in `git diff` while having used the file's content to inform its output (information leakage across task boundaries).

**Why it happens:**
The SDK adapter controls exactly what tools the model can use -- `write_file` is a tool Anvil defines, so Anvil controls its inputs. CLI agents are opaque executors: you hand them a prompt and a working directory, and they do whatever they want inside that directory using their own built-in tools (Bash, Edit, Write, etc.).

**How to avoid:**
1. **Pre-execution filesystem scoping:** Before spawning the CLI agent, set up the worktree to contain ONLY the files in `reads[]` and empty stubs for `writes[]`. Remove or don't checkout other files. This is stronger than post-hoc validation because the agent literally cannot access files outside its declared scope.
2. **Use `--allowedTools` restriction for Claude Code:** `claude -p "..." --allowedTools "Read,Edit,Write" --disallowedTools "Bash"` prevents shell access. For file-scoped enforcement, use the `canUseTool` callback in the TypeScript Agent SDK to inspect file paths before allowing Write/Edit operations.
3. **For Codex CLI:** Use `sandbox_mode: "workspace-write"` with `writable_roots` configured to the worktree path only. Codex has native sandbox enforcement at the OS level (Seatbelt on macOS, seccomp on Linux).
4. **Post-execution validation remains mandatory:** Keep the `git diff --name-only` check as a safety net, but treat it as a backstop, not the primary enforcement. Fail the task and do NOT merge on violation.
5. **Track reads too:** Use filesystem watchers (e.g., `chokidar` on the worktree) or `strace`/`dtrace` to log which files the agent actually read. Compare against `reads[]` and flag information leakage.

**Warning signs:**
- Agent-generated code references functions or types from files not in `reads[]`
- `git diff` shows modifications to files not in `writes[]`
- Agent installs npm packages or modifies `package.json` when not authorized
- Agent runs `git` commands inside the worktree (could mess with branch state)

**Phase to address:**
Adapter interface design (Phase 1). The `AgentAdapter` interface must include a `constrainFilesystem(task: Task, worktreePath: string)` method that each adapter implements differently. If this is deferred, every adapter will reinvent enforcement inconsistently.

---

### Pitfall 2: Cost Tracking Black Box -- CLI Agents Do Not Expose Token Counts the Same Way

**What goes wrong:**
Anvil's `CostTracker` calls `recordFromResponse()` with `response.usage.input_tokens` and `response.usage.output_tokens` directly from the Anthropic SDK response object. This is a clean, synchronous, per-call extraction. CLI agents break this contract in multiple ways:

- **Claude Code CLI (`-p --output-format json`):** Returns `total_cost_usd` and `usage` in the final JSON result message, but this is the AGGREGATE for the entire session, not per-API-call. A single `claude -p` invocation may make 5-15 internal API calls (agent loop with tool use), and you get one rolled-up number.
- **Claude Code TypeScript Agent SDK:** The `SDKResultMessage` (type: "result", subtype: "success") includes `total_cost_usd`, `usage: NonNullableUsage`, and `modelUsage: { [modelName: string]: ModelUsage }`. This is richer but still session-aggregate.
- **OpenAI Codex CLI:** Does not expose token usage in its non-interactive output at all. You must parse JSONL logs or rely on the OpenAI API dashboard.
- **Future backends (Aider, etc.):** Each has its own cost reporting format or none at all.

**Why it happens:**
The SDK gives you per-message granularity because you control the conversation loop. CLI agents own their conversation loop internally -- you are a client of their session, not a participant in their message exchange.

**How to avoid:**
1. **Redefine the cost contract:** The `AgentAdapter` interface should return `{ totalCostUsd: number; inputTokens: number; outputTokens: number; model: string; turnCount: number }` as aggregate values, NOT per-call values. Accept that CLI backends give aggregate-only data.
2. **For Claude Code specifically:** Use `--output-format json` which returns `total_cost_usd` and `usage` in the result. Parse these from stdout JSON. The `usage` field contains `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` as aggregates.
3. **For the TypeScript Agent SDK route:** Iterate over `SDKMessage` events and extract `usage` from each `SDKAssistantMessage.message.usage` for per-turn granularity. This is the highest-fidelity option for Claude Code.
4. **For backends without cost data (Codex, Aider):** The adapter must return `{ totalCostUsd: null, inputTokens: null, outputTokens: null }` with the adapter clearly flagged as "cost-opaque." The `CostTracker` must handle null costs gracefully -- display "cost unknown" for those tasks, not crash or show $0.00.
5. **Never estimate costs from prompt length.** Agents internally compact context, use caching, retry failed calls, and spawn subagents. Your estimate will be wrong by 2-10x.

**Warning signs:**
- Cost report shows $0.00 for tasks that clearly ran
- Cost report shows per-call numbers that are actually session aggregates (inflating the total if you sum "per-call" values that are each the session total)
- Users on non-Claude backends see no cost data at all

**Phase to address:**
Adapter interface design (Phase 1) for the contract, Cost Tracker refactor (Phase 2) for the implementation. The `CostTracker.recordFromResponse()` method signature assumes SDK response shape -- it needs a new `recordFromAdapter()` method that accepts the adapter's normalized output.

---

### Pitfall 3: Subprocess Lifecycle Mismanagement -- Zombie Agents and Stuck Processes

**What goes wrong:**
CLI agents are long-running subprocesses. A single `claude -p "implement auth middleware"` with tool use can run for 30-120 seconds. During that time: the user hits Ctrl+C, Node's event loop crashes, the machine sleeps, the network drops. The CLI agent subprocess continues running -- it has its own API connection, its own retry logic, and its own process lifecycle. With 4 parallel workers, you now have 4 zombie agent processes burning API credits.

This is worse than the v1.0 orphan process pitfall because:
- SDK calls are stateless HTTP requests -- if the parent dies, the in-flight request eventually times out. CLI agents are stateful processes with their own agent loops that keep going.
- CLI agents may spawn their OWN subprocesses (Claude Code runs Bash commands, linters, test suites). Killing the CLI agent process may not kill its children.
- Claude Code specifically creates session files in `~/.claude/projects/` -- orphaned sessions pollute the user's Claude Code state.

**Why it happens:**
Node's `child_process.spawn()` creates a detached process by default on some platforms. `process.kill(pid)` sends SIGTERM, which the CLI agent may catch and try to "gracefully" complete its current API call before exiting (adding 10-30 seconds of extra burn). SIGKILL works but leaves Claude Code's internal state (session files, lock files) corrupted.

**How to avoid:**
1. **Use `AbortController` wired to `spawn()`:** The Claude Code TypeScript Agent SDK accepts `abortController` in options. When the orchestrator needs to cancel, call `abort()` -- this is the cleanest shutdown path because the SDK handles internal cleanup.
2. **If using CLI subprocess (`claude -p`):** Spawn with `{ detached: false }` and store the PID. On cancellation, send SIGTERM, wait 5 seconds, then SIGKILL. Also kill the process GROUP (`process.kill(-pid)`) to catch child processes.
3. **Implement `--max-turns` as a safety net:** Pass `--max-turns 20` (or equivalent) to prevent runaway agent loops. For the Agent SDK, use `maxTurns` in options.
4. **Implement `--max-budget-usd` per task:** Claude Code Agent SDK supports `maxBudgetUsd` -- use it as a hard stop. Set it to `(total_run_budget / number_of_tasks) * 1.5` to allow some headroom per task while capping the total.
5. **Timeout wrapper:** Wrap every adapter `execute()` call in a `Promise.race([execution, timeout(300_000)])`. 5 minutes per task is generous; anything longer suggests the agent is stuck.
6. **Cleanup on startup:** Before any run, check for orphaned Claude Code sessions using `listSessions()` from the Agent SDK and warn the user. Check `.anvil/pids.json` for zombie processes from previous runs.

**Warning signs:**
- `ps aux | grep claude` shows processes from hours ago
- `.claude/projects/` has session files from Anvil-spawned agents that were never closed
- CPU usage stays high after Anvil exits
- Token costs on the API dashboard are higher than what Anvil's cost report shows

**Phase to address:**
Worker execution engine (Phase 2), when the subprocess spawning is actually implemented. The adapter interface (Phase 1) must define `cancel(): Promise<void>` and `isRunning(): boolean` methods so the orchestrator has a clean shutdown contract.

---

### Pitfall 4: Behavioral Divergence Between Backends -- Same Prompt, Different Results

**What goes wrong:**
The same task prompt sent to the SDK adapter, Claude Code CLI adapter, and Codex CLI adapter produces structurally different outputs. Not just different code (expected), but different FILE STRUCTURES: the SDK adapter writes exactly the files in `writes[]` because it uses the `write_file` tool you defined. Claude Code might create additional helper files, split a single file into multiple files, or restructure directories. Codex might use different naming conventions or add configuration files.

This means:
- Touch-map enforcement fails differently per backend
- Sub-Judges produce different results per backend
- The Planner's plan is only valid for one backend's behavior
- Switching backends mid-project produces inconsistent codebases

**Why it happens:**
Each CLI agent has its own system prompt, tool set, and behavioral patterns. Claude Code has strong opinions about file organization. Codex follows OpenAI's coding conventions. The SDK adapter follows YOUR instructions because it uses YOUR system prompt and YOUR tools. CLI agents use THEIR system prompt with your task appended.

**How to avoid:**
1. **Adapter prompt wrapping:** Each adapter's `execute()` must wrap the task prompt in backend-specific instructions that constrain output. For Claude Code: `--append-system-prompt "You MUST write ONLY to these files: [writes list]. Do NOT create additional files. Do NOT modify files not listed."` For Codex: similar constraint in the prompt.
2. **Structural validation post-execution:** Beyond touch-map (which files were modified), validate that the EXPECTED files were created. If `writes[]` says `["src/auth.ts", "src/auth.test.ts"]` but the agent only created `src/auth.ts`, that is a failure.
3. **Normalize adapter output:** The `AgentAdapter.execute()` return type must include `{ filesWritten: string[], filesRead: string[] }` verified against actual filesystem state, not self-reported by the agent.
4. **Do NOT try to make backends behave identically.** Accept behavioral differences and enforce constraints at the orchestrator level (touch-map, structural validation, Sub-Judges). The adapter's job is to translate the task into backend-specific execution, not to make all backends identical.
5. **Integration test suite per adapter:** A standard set of tasks (create a file, modify a file, create multiple files) that each adapter must pass. Run on CI. This catches regressions when backends update.

**Warning signs:**
- Switching `--agent` flag produces different Sub-Judge results for the same plan
- Touch-map violations spike when using a non-SDK backend
- Workers create unexpected files that pollute subsequent waves

**Phase to address:**
Adapter implementation (Phase 2-3, one per backend). The adapter interface (Phase 1) must define the structural validation contract. Testing (Phase 4) must include cross-adapter comparison tests.

---

### Pitfall 5: Leaking Orchestrator Context Into Agent Sessions

**What goes wrong:**
Claude Code and Codex both read project-level configuration files automatically: `CLAUDE.md`, `.claude/settings.json`, `codex.toml`, etc. When Anvil spawns a CLI agent in a worktree, the agent picks up the HOST PROJECT's configuration (Anvil's own `CLAUDE.md`, if present) and follows those instructions instead of (or in addition to) the task-specific instructions from the Planner.

Worse: if the user's project has its own `CLAUDE.md` with rules like "never modify files in src/core/", the agent follows those rules even when the Planner explicitly assigned it to modify `src/core/auth.ts`.

**Why it happens:**
CLI agents walk up the directory tree looking for configuration. A worktree is a real git checkout in a real directory -- it inherits the project's configuration files. The Claude Code Agent SDK defaults to NOT loading filesystem settings (`settingSources` defaults to `[]`), but the CLI (`claude -p`) DOES load them unless told not to.

**How to avoid:**
1. **For the TypeScript Agent SDK:** Explicitly set `settingSources: []` to prevent loading any filesystem settings. Set `systemPrompt` explicitly to your worker prompt. This is the cleanest solution.
2. **For CLI subprocess (`claude -p`):** Use `--system-prompt` to fully replace the default prompt (not `--append-system-prompt` which adds to it). This overrides CLAUDE.md loading.
3. **For Codex CLI:** Set `CODEX_DISABLE_PROJECT_CONFIG=1` (if available) or create a minimal `codex.toml` in the worktree root that overrides the project config.
4. **Worktree sanitization:** Before spawning the agent, remove or rename any agent configuration files (`.claude/`, `CLAUDE.md`, `.codex/`, `codex.toml`) from the worktree. Restore them after execution. This is crude but reliable.
5. **Environment variable isolation:** Spawn agents with a clean env that only contains required variables (`ANTHROPIC_API_KEY`, `PATH`, `HOME`). Do NOT inherit the full `process.env` -- it may contain `CLAUDE_*` variables that alter behavior.

**Warning signs:**
- Agent ignores task instructions in favor of project-level CLAUDE.md rules
- Agent behavior changes when the user adds/modifies their CLAUDE.md
- Agent loads MCP servers configured in the user's global Claude settings
- Different results on different developers' machines due to different global settings

**Phase to address:**
Adapter interface design (Phase 1) must specify that adapters are responsible for environment isolation. Adapter implementation (Phase 2-3) must implement it per-backend.

---

## Moderate Pitfalls

### Pitfall 6: Streaming Output Parsing Fragility

**What goes wrong:**
When using `claude -p --output-format stream-json`, output is newline-delimited JSON. But CLI subprocesses do not guarantee clean line boundaries in stdout -- buffers can split mid-JSON-object, especially under high CPU load when 4 agents run in parallel. Naive `readline`-based parsing produces `SyntaxError: Unexpected end of JSON input` intermittently.

**How to avoid:**
- Use the TypeScript Agent SDK (`@anthropic-ai/claude-agent-sdk`) instead of raw CLI subprocess for Claude Code. The SDK handles streaming internally and provides typed `SDKMessage` objects via an async generator. This eliminates stdout parsing entirely.
- If you must use CLI subprocess: buffer stdout, split on `\n`, attempt `JSON.parse()` on each line, and concatenate incomplete lines with the next chunk before retrying. Use a proven NDJSON parser like `ndjson` or `split2`.
- For `--output-format json` (non-streaming): wait for process exit, then parse the complete stdout as JSON. Simpler but no progress feedback during execution.

**Warning signs:**
- Intermittent JSON parse errors that don't reproduce consistently
- Missing cost data because the final result message was truncated

**Phase to address:**
Adapter implementation for Claude Code (Phase 2). Prefer the Agent SDK over raw CLI to avoid this entirely.

---

### Pitfall 7: Agent Version Drift Breaking Adapter Contracts

**What goes wrong:**
Claude Code CLI updates automatically (it is an npm package that checks for updates). A new version may change: JSON output fields, CLI flag behavior, default tool permissions, error message format, or session file structure. Your adapter, tested against Claude Code v2.1.x, breaks silently on v2.2.x because a field was renamed or a default changed.

Codex CLI has the same issue -- it ships frequent updates with potentially breaking changes to its `exec` mode output format.

**How to avoid:**
1. **Pin CLI versions in documentation and CI.** Tell users: "Anvil v1.1 is tested with Claude Code >= 2.1.70." Check the version at startup (`claude --version`) and warn if it is outside the tested range.
2. **Defensive parsing:** Never destructure agent output with `const { result, usage, cost_usd } = output`. Always use optional chaining and default values: `output?.usage?.input_tokens ?? null`. Validate output against a Zod schema before using it.
3. **For the Agent SDK:** Pin the npm package version in `package.json`. The SDK versioning is more stable than the CLI because it is a library dependency you control.
4. **Version-gated adapters:** The adapter can check `claude --version` and use different parsing logic for different versions. But keep this simple -- support at most 2 major versions.

**Warning signs:**
- Adapter tests pass locally but fail in CI (different CLI version)
- Users report "cost tracking stopped working" after a Claude Code update
- JSON parse errors on fields that used to exist

**Phase to address:**
Adapter implementation (Phase 2-3). Add version detection to the adapter initialization and include version in error messages for debugging.

---

### Pitfall 8: Working Directory Confusion in Worktrees

**What goes wrong:**
CLI agents resolve relative paths from their working directory. If the adapter spawns `claude -p` with `cwd: worktreePath`, the agent operates relative to the worktree root -- correct. But if the agent runs a shell command (e.g., `npm test`), that command inherits the cwd -- also correct. The problem arises when:
- The agent references the MAIN repo path (from env vars, cached paths, or resolved symlinks)
- The agent runs `git` commands that operate on the main repo instead of the worktree
- Package managers (`npm`, `pnpm`) resolve the lockfile from the root repo, not the worktree
- Path resolution differs between macOS (case-insensitive, symlink resolution) and Linux

**How to avoid:**
- Always set `cwd` explicitly when spawning agents. For the Agent SDK: `options.cwd = worktreePath`. For CLI: `spawn('claude', args, { cwd: worktreePath })`.
- Sanitize environment variables: unset `GIT_DIR`, `GIT_WORK_TREE`, `npm_config_prefix`, and any path variables that reference the main repo.
- Test with both absolute and relative paths in task file references.

**Warning signs:**
- Agent modifies files in the main repo instead of the worktree
- `git status` in the agent shows different results than expected
- npm commands fail with "lockfile mismatch" errors

**Phase to address:**
Adapter implementation (Phase 2). Include a worktree-specific test that verifies file operations stay within the worktree.

---

### Pitfall 9: Permission Prompts Blocking Non-Interactive Execution

**What goes wrong:**
CLI agents have permission systems. Claude Code prompts for permission before running Bash commands, editing files outside the project, or using certain tools. Codex has approval policies. If the adapter does not configure permissions correctly, the agent blocks waiting for user input on stdin -- which never comes because it is running non-interactively as a subprocess. The process hangs indefinitely.

**How to avoid:**
- **Claude Code Agent SDK:** Use `permissionMode: 'bypassPermissions'` with `allowDangerouslySkipPermissions: true`. OR use `permissionMode: 'dontAsk'` with `allowedTools` pre-configured to include all tools the agent needs, and `disallowedTools` for tools it should never use.
- **Claude Code CLI:** Use `--allowedTools "Read,Write,Edit,Bash"` to pre-approve tools. Be specific with Bash patterns: `--allowedTools "Bash(npm test *),Bash(tsc *)"` to allow only specific commands.
- **Codex CLI:** Use `--full-auto` which sets `approval_policy: "on-request"` with workspace-write sandbox, or `--approval-policy never` for full automation.
- **Never** use `bypassPermissions` without also restricting tools via `disallowedTools`. Bypassing permissions AND allowing all tools means the agent can do anything on the machine.

**Warning signs:**
- Agent processes hang with 0% CPU usage (waiting for stdin)
- Adapter timeouts trigger on every task
- Works in development (where terminal is attached) but fails in CI/automation

**Phase to address:**
Adapter implementation (Phase 2). This MUST be validated in the first integration test for each adapter. A non-interactive test that runs a simple file-creation task end-to-end.

---

## Minor Pitfalls

### Pitfall 10: Session File Pollution

**What goes wrong:**
Claude Code creates session JSONL files in `~/.claude/projects/<project-hash>/`. Each Anvil worker task spawns a new Claude Code session. A plan with 12 tasks across 3 waves creates 12 session files. Over multiple runs, hundreds of session files accumulate, consuming disk space and slowing Claude Code's session listing.

**How to avoid:**
- Use `persistSession: false` in the Agent SDK options to disable session persistence.
- For CLI: sessions are always persisted. Accept this and document it as a known side effect. Users can clean up with `claude sessions --delete`.
- Consider using a single Claude Code session per wave (continuing with `--resume`) instead of one per task, reducing session count by the parallelism factor.

**Phase to address:**
Adapter implementation (Phase 2). Low priority but should be documented.

---

### Pitfall 11: API Key Routing Confusion

**What goes wrong:**
Anvil passes the `ANTHROPIC_API_KEY` to the SDK adapter via the `Anthropic()` client constructor. CLI agents discover API keys differently: Claude Code checks `~/.claude/credentials`, environment variables, and OAuth tokens. Codex uses `OPENAI_API_KEY`. If the user has Claude Code configured with a different API key (e.g., a personal key) than the one Anvil is configured with (e.g., a project key), the cost shows up on the wrong account, rate limits differ, and model access may differ.

**How to avoid:**
- Explicitly pass the API key via environment variable when spawning agents: `spawn('claude', args, { env: { ...minimalEnv, ANTHROPIC_API_KEY: config.apiKey } })`.
- For the Agent SDK: set `env: { ANTHROPIC_API_KEY: config.apiKey }` in options to override any ambient credentials.
- For Codex: set `OPENAI_API_KEY` in the spawn environment.
- Document that Anvil uses its own API key configuration, not the user's global agent credentials.

**Phase to address:**
Adapter interface design (Phase 1) -- the adapter must accept an API key and forward it to the backend.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Parse CLI stdout instead of using Agent SDK | No SDK dependency, simpler initial impl | Fragile parsing, no streaming progress, version drift | Never for Claude Code -- the TS Agent SDK exists and is better in every way |
| Skip touch-map pre-enforcement, rely only on post-validation | Faster adapter implementation | Wasted tokens on work that gets rejected | Only for MVP/proof-of-concept, must add pre-enforcement before v1.1 GA |
| Single `bypassPermissions` for all tools | No permission configuration needed | Agent can run any shell command, delete files, access network | Never in production -- always pair with `disallowedTools` |
| Hardcode adapter behavior instead of interface | Faster to build first adapter | Adding second adapter requires refactoring | Only if shipping single adapter first, but design the interface anyway |
| Return `null` costs for non-Claude backends | Unblocks non-Claude adapter shipping | Users have no cost visibility, budget enforcement is impossible | Only for initial release -- must add cost estimation before recommending non-Claude backends |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code Agent SDK | Using `settingSources: ['user', 'project', 'local']` which loads ambient config | Use `settingSources: []` and configure everything programmatically |
| Claude Code CLI `-p` | Forgetting `--output-format json` and trying to parse human-readable text output | Always use `--output-format json` for structured data extraction |
| Codex CLI `exec` | Not setting `--full-auto` which causes stdin prompts | Always use `--full-auto` or `--approval-policy never` for non-interactive use |
| Any CLI agent in worktree | Not setting `cwd` on the spawn options | Always set `cwd` to the worktree path explicitly |
| Agent SDK `query()` | Not consuming the async generator to completion | Always iterate until done; uncompleted generators leak the child process |
| Agent SDK permissions | Using `bypassPermissions` without `disallowedTools` | Always pair bypass with explicit deny list for dangerous tools |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Passing full `process.env` to agent subprocess | Agent inherits secrets, API keys for other services, internal URLs | Construct a minimal env: `PATH`, `HOME`, `ANTHROPIC_API_KEY`, `NODE_ENV` only |
| Not disabling network access for agents | Agent can exfiltrate code to external URLs, install malicious packages | Use `disallowedTools: ["Bash(curl *)", "Bash(wget *)"]` at minimum; for stronger isolation use Codex sandbox |
| Allowing agents to run `git push` | Agent pushes broken code to remote | Disallow `Bash(git push *)` and `Bash(git remote *)` in allowedTools |
| Trusting agent self-reported file lists | Agent says it wrote 3 files but actually wrote 5 | Always verify against `git diff --name-only`, never trust agent output |

## "Looks Done But Isn't" Checklist

- [ ] **Adapter interface:** Has `execute()` but missing `cancel()` and `isRunning()` -- verify lifecycle methods exist
- [ ] **Cost tracking:** Shows a dollar amount but it is the SAME amount for every task -- likely parsing session aggregate as per-task value
- [ ] **Touch-map enforcement:** Passes for SDK adapter but was never tested with CLI adapters -- verify with a deliberately violating agent prompt
- [ ] **Permission configuration:** Works in dev but hangs in CI -- verify non-interactive execution without terminal attached
- [ ] **Worktree isolation:** Agent stays in worktree for simple tasks but escapes for tasks requiring `npm install` -- verify with package-management tasks
- [ ] **Error handling:** Adapter returns success/failure but does not capture agent stderr -- verify error messages propagate to the user
- [ ] **Timeout handling:** Set a timeout but never tested what happens when it fires -- verify the agent process is actually killed, not just the promise rejected
- [ ] **Environment isolation:** Works on your machine but fails on others -- verify no dependency on global Claude Code settings or cached sessions

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Touch-map bypass (agent wrote unauthorized files) | LOW | `git checkout -- <files>` in worktree before merge; task already failed, just clean up |
| Cost tracking returns nulls | LOW | Retroactively check API dashboard; fix adapter parsing; re-run cost report from session data |
| Zombie agent processes | MEDIUM | `kill -9` processes from `.anvil/pids.json`; clean up orphaned sessions; warn user about unbilled costs |
| Behavioral divergence broke Sub-Judges | MEDIUM | Roll back the wave merge; adjust adapter prompt wrapping; re-run affected tasks |
| Agent loaded project CLAUDE.md and followed wrong instructions | HIGH | Entire task output is suspect; must re-run with environment isolation; potentially re-run full wave |
| Permission prompt hung the process | LOW | Kill process, add permission configuration, re-run; no data was lost, just time |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Touch-map bypass (P1) | Phase 1: Adapter interface with `constrainFilesystem()` | Integration test: agent prompt that deliberately writes outside `writes[]` must fail |
| Cost tracking black box (P2) | Phase 1: Interface contract; Phase 2: CostTracker refactor | Unit test: adapter returns cost data; cost report includes CLI-backed tasks |
| Zombie processes (P3) | Phase 2: Worker execution engine | Integration test: kill orchestrator mid-run, verify agent processes die within 10s |
| Behavioral divergence (P4) | Phase 2-3: Per-adapter implementation | Cross-adapter test suite: same task, both adapters, same structural output |
| Context leakage (P5) | Phase 1: Interface specifies isolation; Phase 2: Implementation | Test: create CLAUDE.md with conflicting rules, verify agent ignores it |
| Streaming parse fragility (P6) | Phase 2: Claude Code adapter | Use Agent SDK instead of CLI subprocess (avoids entirely) |
| Version drift (P7) | Phase 2-3: Defensive parsing | CI matrix testing with pinned CLI versions |
| Working directory confusion (P8) | Phase 2: Adapter implementation | Integration test: verify no files modified outside worktree |
| Permission prompts (P9) | Phase 2: First integration test per adapter | Test: run adapter with no terminal attached, must not hang |
| Session pollution (P10) | Phase 2: Agent SDK adapter | Use `persistSession: false` in SDK options |
| API key routing (P11) | Phase 1: Interface accepts API key | Test: different keys for ambient and explicit, verify correct one is used |

## Sources

- [Claude Code Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript) -- SDKResultMessage cost fields, Options type, permission modes, settingSources
- [Run Claude Code Programmatically](https://code.claude.com/docs/en/headless) -- CLI `-p` mode, `--output-format json`, `--allowedTools` syntax
- [Codex CLI Sandboxing](https://developers.openai.com/codex/concepts/sandboxing) -- sandbox modes, writable_roots, approval policies
- [Codex CLI Non-Interactive Mode](https://developers.openai.com/codex/noninteractive) -- `exec` subcommand, `--full-auto` preset
- [Practical Security for Sandboxing Agentic Workflows (NVIDIA)](https://developer.nvidia.com/blog/practical-security-guidance-for-sandboxing-agentic-workflows-and-managing-execution-risk/) -- filesystem write restrictions as mandatory control
- [AI Agent Orchestration Cost Pitfalls (Talentica)](https://www.talentica.com/blogs/ai-agent-orchestration-best-practices/) -- cost amplification in multi-agent systems
- [Using Git Worktrees with AI Agents (Nick Mitchinson)](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/) -- worktree isolation patterns
- [Claude Code SDK TypeScript Changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md) -- API stability and breaking changes

---
*Pitfalls research for: Anvil v1.1 configurable CLI agent backends*
*Researched: 2026-03-21*
