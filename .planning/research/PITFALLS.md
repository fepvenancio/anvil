# Domain Pitfalls

**Domain:** AI Agent Orchestration CLI (parallel workers, git worktrees, code review pipelines)
**Project:** Anvil
**Researched:** 2026-03-20

## Critical Pitfalls

Mistakes that cause rewrites, runaway costs, or architectural dead ends.

---

### Pitfall 1: The Planner-Coder Gap (Underspecified Plans)

**What goes wrong:** The Planner produces task descriptions that are ambiguous or lack critical implementation details. Workers then misinterpret requirements, generating code that technically satisfies the letter of the plan but misses the intent. Research shows the planner-coder gap accounts for 75.3% of failures in multi-agent code generation systems, with semantically equivalent inputs causing 7.9%-83.3% failure rates.

**Why it happens:** LLMs are good at high-level decomposition but struggle to specify the precise contracts between components -- expected function signatures, data shapes, error handling strategies. The Planner "thinks" in natural language while Workers need implementation-grade specificity. Information is lost at every handoff boundary.

**Consequences:** Workers produce code that compiles and passes syntax checks but has logical errors, wrong assumptions about shared interfaces, or incompatible data contracts between tasks. Sub-Judges (mechanical checks) cannot catch semantic misalignment -- only the High Court review catches it, by which point all waves have completed and the cost is sunk.

**Warning signs:**
- Workers frequently trigger PLAN_GAP escalations
- High Court repeatedly finds interface mismatches between files produced by different Workers
- Tests pass individually per task but fail when integrated

**Prevention:**
- Planner must emit explicit interface contracts: function signatures, type definitions, and data shapes for every cross-task boundary
- Planner's `plan.schema.json` should include a `shared_interfaces` field listing TypeScript type signatures that Workers must consume
- Require the Planner to produce a `touch_map` that explicitly shows read/write dependencies AND the expected data contract at each boundary
- Implement a plan validation step before Workers start: a lightweight mechanical check that every `depends_on` reference has a matching interface contract
- Use Claude's tool_use to force structured JSON output from the Planner -- never free-text parse plan output

**Detection:** Track PLAN_GAP frequency per wave. If >20% of tasks trigger PLAN_GAP in the first 3 runs, the plan schema needs richer specification fields.

**Phase relevance:** Must be addressed in Planner Station design (early phase). Retrofitting richer plan schemas after Workers are built causes cascading schema changes.

**Confidence:** HIGH -- backed by peer-reviewed research (arxiv:2510.10460) and directly relevant to Anvil's Planner/Worker split.

---

### Pitfall 2: Git Worktree Lifecycle Mismanagement

**What goes wrong:** Worktrees are created for each Worker task but not reliably cleaned up on failure, cancellation, or crash. Stale worktrees accumulate, branches get locked (Git enforces one-worktree-per-branch), disk usage balloons (reported: 9.82 GB in 20 minutes for a 2 GB codebase), and subsequent runs fail with cryptic Git errors about already-checked-out branches.

**Why it happens:** The happy path is easy -- create worktree, do work, merge, delete. But the unhappy paths are numerous: Worker crashes mid-task, user hits Ctrl+C, Node process gets SIGKILL, network timeout during API call, out-of-memory kill. Each failure mode leaves different cleanup debris.

**Consequences:**
- `git worktree add` fails because branch is still checked out in a zombie worktree
- Disk fills up on machines with limited storage (Anvil targets solo devs, not beefy CI servers)
- `git worktree list` shows dozens of stale entries, confusing subsequent runs
- Manual folder deletion without `git worktree remove` corrupts worktree metadata

**Warning signs:**
- Users report "branch already checked out" errors on second run
- Disk usage complaints
- `git worktree list` shows entries pointing to non-existent directories

**Prevention:**
- Implement a WorktreeManager with three guarantees: (1) startup cleanup -- prune stale worktrees from previous crashed runs, (2) shutdown cleanup -- graceful removal on completion, (3) signal-handler cleanup -- SIGTERM/SIGINT handlers that remove worktrees before exit
- Use a `.anvil/worktrees.json` manifest tracking active worktrees with PIDs and timestamps -- on startup, prune any entry whose PID is dead
- Use unique branch names with run ID prefix (e.g., `anvil/run-abc123/task-1`) so stale branches from crashed runs are identifiable and batch-deletable
- Call `git worktree prune` at the start of every `anvil run`
- Set a worktree TTL -- if a worktree has existed for >1 hour without a commit, it is presumed stale

**Detection:** Add an `anvil cleanup` command that lists and removes orphaned worktrees. Run cleanup automatically at the start of every session.

**Phase relevance:** Must be rock-solid in the Worker Station implementation phase. This is infrastructure that everything else depends on.

**Confidence:** HIGH -- well-documented in git worktree literature and multiple community reports.

---

### Pitfall 3: Error Cascade Amplification Across Waves

**What goes wrong:** A subtle error in Wave 1 (wrong type exported, incorrect file path convention, bad assumption about project structure) propagates through every subsequent wave. Each wave builds on the merged output of previous waves, so a bad foundation compounds. By Wave 3, the codebase is internally inconsistent in ways that no single Sub-Judge check can diagnose because each file is locally correct.

**Why it happens:** Sub-Judges run mechanical checks (syntax, types, tests, security, touch map compliance). These are necessary but insufficient -- they verify local correctness, not cross-wave semantic coherence. The High Court only runs once at the end, which is too late to catch foundational errors cheaply. This is the "17x error trap": errors amplify across uncoordinated agent stages without feedback loops.

**Consequences:**
- High Court aborts the entire build after all waves complete, wasting 100% of compute
- Workers in later waves produce correct code that is incompatible with the (flawed) foundation
- Retry loops burn tokens rebuilding everything from scratch

**Warning signs:**
- Sub-Judges pass every wave but High Court consistently aborts
- Type errors only surface during final merge
- Workers in later waves report unexpected file contents (from earlier waves)

**Prevention:**
- Add a full-project coherence check between waves: after merging Wave N, run `tsc --noEmit` on the full project (not just the new files) before starting Wave N+1
- Consider a "Mini Court" after each wave -- not the full High Court, but a fast LLM check that reads the wave's handoff summaries against the original plan and flags drift
- Make Sub-Judges wave-aware: they should check not just "does this file compile" but "does this file's exported interface match what the plan said it would export"
- Implement an early-abort threshold: if Sub-Judges report >N warnings in a wave, pause and escalate rather than continuing

**Detection:** Track Sub-Judge pass rates across waves. A pattern of "all pass" in early waves followed by High Court abort indicates cascade amplification.

**Phase relevance:** Sub-Judge and wave execution design. The temptation will be to ship basic Sub-Judges first and "add smarter checks later" -- but by then the wave execution loop is locked in and adding inter-wave checks requires refactoring the orchestration loop.

**Confidence:** HIGH -- "17x error trap" is documented in multi-agent literature; directly maps to Anvil's wave architecture.

---

### Pitfall 4: Orphaned Child Processes and Resource Leaks

**What goes wrong:** Anvil spawns parallel Worker processes (or at minimum parallel Anthropic API calls). If the parent orchestrator dies (SIGKILL, OOM, crash), child processes and API connections continue running. Workers keep generating code, burning tokens, and writing to worktrees -- but nobody is collecting the results.

**Why it happens:** Node.js child processes do NOT automatically die when their parent exits. SIGKILL cannot be caught, so graceful shutdown handlers never fire. If Workers are implemented as `child_process.spawn()` or `child_process.fork()`, they become orphaned processes adopted by PID 1. Even if Workers are async functions in the same process, dangling API connections and file handles persist.

**Consequences:**
- Token cost continues accumulating with no useful output
- Worktrees are modified by zombie Workers, corrupting state for the next run
- On resource-constrained machines (target: solo devs), 4+ orphaned Worker processes can make the machine unresponsive
- Users see mysterious `.anvil/` state that doesn't match what they think happened

**Warning signs:**
- Token costs higher than expected after cancelled runs
- `ps aux | grep anvil` shows processes from previous sessions
- Worktree files modified after `anvil cancel` was run

**Prevention:**
- Write the orchestrator PID and all child PIDs to `.anvil/pids.json` at startup
- On startup, check for and kill any processes from `.anvil/pids.json` that are still running
- Use process groups (`detached: false` + `process.kill(-pid)`) so killing the group kills all children
- Implement AbortController for all Anthropic API calls, wired to the orchestrator's shutdown signal
- Add a heartbeat: Workers check every 30s that the orchestrator is still alive; if not, self-terminate
- For `anvil cancel`: send SIGTERM to process group, wait 5s, then SIGKILL

**Detection:** `anvil status` should always check for orphaned processes and warn the user.

**Phase relevance:** Orchestrator/Worker process model design. Must be decided before Workers are implemented because it affects whether Workers are child processes, worker threads, or async functions.

**Confidence:** HIGH -- standard Node.js process management concern, well-documented.

---

### Pitfall 5: Token Cost Explosion Without Circuit Breakers

**What goes wrong:** A single `anvil run` with 4 parallel Workers across 3 waves can make 50+ API calls to Claude. If the Planner produces an overly ambitious plan (too many tasks) or Workers enter retry loops (code doesn't compile, fix, recompile, still broken), token costs can spiral from an expected $2 to $50+ in a single run. Solo devs discover this on their credit card statement.

**Why it happens:** Multi-agent token consumption scales super-linearly: each Worker independently explores its context, backtracks, and retries. Retry loops are especially dangerous -- a Worker that can't get `tsc` to pass will keep iterating, each attempt consuming the full context window. Research shows production multi-agent costs can be 2-3x test costs, with agentic tokens consuming 100x more than simple prompting.

**Consequences:**
- Users abandon the tool after one expensive run
- Trust is destroyed -- users need confidence that `anvil run` won't drain their API balance
- Retry loops produce diminishing returns: if the first 3 attempts failed, attempt 4-10 probably will too

**Warning signs:**
- Any single Worker consuming >50K output tokens
- Total run cost exceeding 3x the estimated cost
- Workers making >3 attempts at the same sub-task

**Prevention:**
- Implement per-run budget limits (default: $5, configurable with `--budget`)
- Implement per-Worker token limits (max output tokens per task)
- Hard cap on Worker retry attempts: 3 retries max, then PLAN_GAP escalation
- Cost Auditor must be real-time, not post-hoc: track running totals and pause the run if approaching budget
- Display estimated cost BEFORE execution starts (based on plan complexity) with user confirmation for runs estimated above threshold
- Show live cost ticker during execution (`anvil status` or inline output)

**Detection:** Cost Auditor reports after every wave. Alert immediately if any wave exceeds 50% of total budget.

**Phase relevance:** Must be designed into the orchestrator from day one. The Cost Auditor cannot be a bolt-on -- it needs hooks into every API call.

**Confidence:** HIGH -- token cost explosion is the number one complaint in multi-agent system deployments.

---

## Moderate Pitfalls

---

### Pitfall 6: Touch Map Enforcement Gaps

**What goes wrong:** The Planner declares which files each Worker can read/write (touch map). But enforcement is harder than it sounds: Workers can instruct the LLM to generate code that imports from files not in their read list, or write to paths using dynamic string construction that bypasses static path checks.

**Prevention:**
- Enforce touch maps at the git level: after Worker completes, `git diff --name-only` against the worktree and reject any file not in the touch map's write list
- Validate imports/requires in generated code against the read list (AST-level check or simple regex for TypeScript imports)
- Fail hard on touch map violations -- do not merge the Worker's output, trigger PLAN_GAP instead
- Consider filesystem-level enforcement: create worktrees with only declared read files symlinked in

**Warning signs:** High Court finds files modified that weren't in any task's write list. Workers importing modules they shouldn't know about.

**Phase relevance:** Worker Station implementation. Easier to enforce strictly from the start than to tighten later.

**Confidence:** MEDIUM -- Forge had this mechanism; the risk is in the TypeScript reimplementation missing edge cases.

---

### Pitfall 7: Merge Order Sensitivity Within Waves

**What goes wrong:** Within a wave, all Workers operate in parallel on separate worktrees. After the wave completes, worktrees must be merged back to main. If the Planner allowed overlapping reads (Worker A reads file X, Worker B also reads file X but writes file Y that imports from X), the merge order can matter even when there are no textual conflicts. Worker B's code may depend on the pre-wave version of X, but Worker A modified X.

**Prevention:**
- Anvil's design already prohibits overlapping writes (good), but overlapping reads with writes must also be checked
- The Planner's dependency graph should flag any task that reads a file another task writes as a dependency (not parallelizable)
- After merge, re-run `tsc --noEmit` to catch interface breaks that Git's textual merge missed
- Merge in deterministic order (by task ID) so results are reproducible even if order-sensitive

**Warning signs:** Successful git merge (no textual conflicts) followed by type errors or test failures.

**Phase relevance:** Planner Station (dependency graph generation) and wave execution (merge strategy).

**Confidence:** MEDIUM -- inherent to the wave architecture design, but preventable with correct dependency analysis.

---

### Pitfall 8: Context Window Exhaustion in Workers

**What goes wrong:** Workers operating on large or growing codebases need to read existing files (from their read list) plus generate new code. If a task requires reading 10 files of 500 lines each, plus generating a complex implementation, the context window fills up. The Worker starts "forgetting" earlier file contents, producing code with wrong import paths, missing function parameters, or inconsistent type usage -- the "lost in the middle" problem.

**Prevention:**
- Planner should estimate context budget per task: sum of read file sizes + expected output size must fit within 80% of context window
- If a task's context budget exceeds limits, Planner must decompose further or the orchestrator must use file summarization (read only interfaces/type signatures, not full implementations)
- Workers should receive files in dependency order (most-depended-on first) so the most critical context is in the "attention-rich" beginning of the prompt
- Use extended thinking to offload reasoning from the main context window

**Warning signs:** Workers produce code that references wrong function signatures from files they were given. Import paths that don't match actual file locations.

**Phase relevance:** Planner Station (task sizing) and Worker Station (prompt construction).

**Confidence:** HIGH -- "lost in the middle" problem is well-documented for long contexts.

---

### Pitfall 9: npx Cold Start and Dependency Weight

**What goes wrong:** Anvil targets `npx anvil@latest run "..."` as the zero-setup entry point. But npx downloads the package fresh each time (unless cached), and if Anvil has heavy dependencies (better-sqlite3 requires native compilation, large SDK bundles), the first-run experience is 30-60 seconds of "installing dependencies" before anything happens. Users think it is broken.

**Prevention:**
- Keep the dependency tree minimal and avoid native modules where possible (use sql.js or JSON-only state instead of better-sqlite3 for zero native compilation)
- Lazy-load heavy dependencies (Anthropic SDK, git libraries) so the CLI responds instantly with a progress indicator
- Bundle with tsup/esbuild to ship a single file, avoiding npx dependency resolution overhead
- Display a clear "First run: downloading..." message immediately so users know it is working
- Consider making SQLite optional -- JSON-only for simple runs, SQLite for audit-heavy usage

**Warning signs:** First-run takes >10 seconds. Users file issues saying "npx anvil hangs."

**Phase relevance:** CLI scaffold and packaging phase (first phase). DX decisions here set user expectations permanently.

**Confidence:** MEDIUM -- standard CLI distribution concern, well-understood mitigation strategies.

---

### Pitfall 10: Handoff-First Review Blindness in High Court

**What goes wrong:** The High Court reads Worker handoff summaries first, diving into code only on escalation. This is efficient but creates a vulnerability: if a Worker's summary is confidently wrong ("Implemented auth middleware with JWT validation" when the code actually has a critical security flaw), the High Court may accept it without code review. LLMs are excellent at producing convincing summaries of flawed work.

**Prevention:**
- High Court should always sample-check code for a random subset of tasks (e.g., 30%), regardless of handoff confidence
- Require handoff summaries to include specific, verifiable claims: "Function `validateToken` at line 42 of `auth.ts` checks expiry" -- the High Court can then spot-check these specific claims against actual code
- Sub-Judges should include a "summary accuracy" check: does the handoff summary's claimed file list match the actual `git diff`?
- For security-sensitive tasks (auth, data access, API keys), always escalate to full code review regardless of handoff quality

**Warning signs:** High Court merge rate is suspiciously high (>90%). Post-merge bugs that should have been caught in review.

**Phase relevance:** High Court implementation and handoff schema design.

**Confidence:** MEDIUM -- logical extrapolation from Forge's handoff-first model. The attack vector is clear even without direct failure data.

---

## Minor Pitfalls

---

### Pitfall 11: simple-git Library Limitations for Worktree Operations

**What goes wrong:** Anvil's stack specifies `simple-git` for Git operations. However, simple-git has limited native worktree support -- it lacks dedicated methods for `git worktree add`, `git worktree remove`, `git worktree list`, and `git worktree prune`. You end up calling `git.raw()` for all worktree operations, losing type safety and error handling benefits.

**Prevention:**
- Build a thin `WorktreeManager` abstraction early that wraps `git.raw()` calls with proper TypeScript typing and error handling
- Alternatively, use `execa` or Node's `child_process.execFile` directly for worktree operations and `simple-git` for standard git operations (status, add, commit, merge)
- Write integration tests for worktree operations against a real git repo in temp directories

**Phase relevance:** Worker Station foundation phase.

**Confidence:** MEDIUM -- based on simple-git docs showing no dedicated worktree API.

---

### Pitfall 12: State File Corruption Under Concurrent Writes

**What goes wrong:** Multiple Workers completing simultaneously attempt to update `.anvil/state.json` or the audit log. Without file locking or a write-through queue, concurrent writes produce corrupted JSON or lost updates.

**Prevention:**
- Centralize all state writes through the orchestrator process -- Workers report completion to the orchestrator via IPC or promise resolution, and only the orchestrator writes state files
- If using SQLite, it handles its own locking (with WAL mode for concurrent reads)
- Never let Workers write to shared state files directly

**Phase relevance:** Orchestrator and state management design.

**Confidence:** HIGH -- standard concurrent file access concern.

---

### Pitfall 13: Dependency Graph Cycles and Implicit Dependencies

**What goes wrong:** The Planner produces a dependency graph with a cycle (Task A depends on Task B, Task B depends on Task A). The topological sort either crashes or silently drops tasks. More subtly: the Planner produces no explicit cycle but an implicit one through file dependencies (Task A writes X, Task B reads X and writes Y, Task C reads Y and writes Z which Task A reads).

**Prevention:**
- Run cycle detection on the dependency graph before execution starts; reject the plan and trigger PLAN_AMBIGUOUS if cycles are found
- Validate that the touch map is consistent with `depends_on`: if Task A reads a file that Task B writes, Task A must depend on Task B
- Auto-infer dependencies from touch maps as a safety net on top of Planner-declared dependencies
- Fail fast with a clear error message identifying the cycle, not a generic graph error

**Phase relevance:** Plan validation step, before wave execution begins.

**Confidence:** HIGH -- standard graph algorithm concern, but easy to miss if you trust the LLM to produce valid graphs.

---

### Pitfall 14: Non-Deterministic Sub-Judges

**What goes wrong:** If any Sub-Judge uses AI instead of mechanical checks, results become inconsistent. Same code passes sometimes, fails others. Flaky gates destroy trust in the pipeline.

**Prevention:** Sub-Judges MUST be deterministic. Use tsc, test runners, eslint -- not Claude. High Court is the only AI-powered reviewer. This is a Forge design principle to preserve absolutely. If a check seems to need AI judgment, it belongs in the High Court, not Sub-Judges.

**Phase relevance:** Sub-Judge pipeline implementation.

**Confidence:** HIGH -- Forge design principle with clear rationale.

---

### Pitfall 15: Claude Model Version Drift

**What goes wrong:** Prompts tuned for one Claude model version behave differently on a newer version. Plan quality, Worker output format, or High Court judgment changes subtly after a model update.

**Prevention:** Pin model version in config (e.g., `claude-sonnet-4-20250514`). Allow override via CLI flag or config. Test prompts when upgrading. Version the prompt templates alongside the model version they were tested against.

**Phase relevance:** Every phase that writes LLM prompts.

**Confidence:** MEDIUM -- well-understood LLM deployment concern.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| CLI Scaffold and Packaging | Cold start DX (Pitfall 9) | Bundle aggressively, lazy-load, zero native deps |
| Planner Station | Underspecified plans (Pitfall 1), Dependency cycles (Pitfall 13) | Rich plan schema with interface contracts, cycle detection, touch map consistency validation |
| Worker Station | Worktree lifecycle (Pitfall 2), Context exhaustion (Pitfall 8), simple-git limits (Pitfall 11) | WorktreeManager with cleanup guarantees, context budgeting, typed git abstractions |
| Orchestrator | Orphaned processes (Pitfall 4), State corruption (Pitfall 12) | Process group management, centralized state writes, PID tracking |
| Wave Execution | Error cascading (Pitfall 3), Merge order (Pitfall 7) | Inter-wave coherence checks (`tsc --noEmit`), read/write dependency validation |
| Sub-Judges | Insufficient for semantic errors (Pitfall 3), Non-deterministic (Pitfall 14), Touch map gaps (Pitfall 6) | Full-project type check between waves, mechanical-only rule, git-level enforcement |
| High Court | Handoff blindness (Pitfall 10) | Mandatory code sampling, verifiable summary claims |
| Cost Auditor | Token explosion (Pitfall 5) | Real-time budget tracking with circuit breakers from day one, not post-hoc reporting |

## Sources

- [The Planner-Coder Gap (arxiv:2510.10460)](https://arxiv.org/abs/2510.10460) -- 75.3% of failures from information loss at plan-to-code boundary
- [Why Multi-Agent LLM Systems Fail (Augment Code)](https://www.augmentcode.com/guides/why-multi-agent-llm-systems-fail-and-how-to-fix-them) -- specification (41.77%) and coordination (36.94%) cause 79% of breakdowns
- [The 17x Error Trap (Towards Data Science)](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/) -- error amplification in uncoordinated agent stages
- [Git Worktree: Pros, Cons, and Gotchas (Josh Tune)](https://joshtune.com/posts/git-worktree-pros-cons/) -- worktree lifecycle issues and cleanup
- [Clash: Worktree Conflict Detection (GitHub)](https://github.com/clash-sh/clash) -- early conflict detection for parallel worktrees
- [Git Worktrees for Parallel AI Agents (Upsun)](https://devcenter.upsun.com/posts/git-worktrees-for-parallel-ai-coding-agents/) -- node_modules, disk space, setup repetition
- [Codex App Worktrees Explained (Verdent)](https://www.verdent.ai/guides/codex-app-worktrees-explained) -- parallel agent worktree patterns
- [Context Window Problem (Factory.ai)](https://factory.ai/news/context-window-problem) -- context rot and management strategies
- [The Hidden AI Cost Explosion (Chrono)](https://www.chronoinnovation.com/resources/hidden-cost-explosion-in-ai) -- 100x token consumption in agentic workflows
- [Why AI Agent Pilots Fail (Composio)](https://composio.dev/blog/why-ai-agent-pilots-fail-2026-integration-roadmap) -- 40% cancellation rate due to cost and complexity
- [5 Tips for Cleaning Orphaned Node.js Processes](https://medium.com/@arunangshudas/5-tips-for-cleaning-orphaned-node-js-processes-196ceaa6d85e) -- child process lifecycle management
- [Anthropic Context Windows Documentation](https://platform.claude.com/docs/en/build-with-claude/context-windows) -- context management strategies
