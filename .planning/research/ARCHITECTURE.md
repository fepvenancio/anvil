# Architecture Patterns

**Domain:** AI agent orchestration CLI (code generation factory)
**Researched:** 2026-03-20

## Recommended Architecture

Anvil follows a **pipeline-of-stations** architecture with wave-based parallel execution. The system is a CLI process that spawns no servers -- it runs as a single long-lived Node.js process that orchestrates sub-processes (git operations, Anthropic API calls) and writes state to disk.

```
User CLI Command
       |
       v
  [Orchestrator]  <-- central event loop, owns all state transitions
       |
       +---> [Planner Station]  --> produces Plan (task DAG)
       |
       +---> [Wave Scheduler]   --> topological sort, groups tasks into waves
       |
       +---> [Worker Pool]      --> parallel Workers in git worktrees (1 per task)
       |         |
       |         +---> [Worker 1] (worktree: .anvil/worktrees/task-001/)
       |         +---> [Worker 2] (worktree: .anvil/worktrees/task-002/)
       |         +---> [Worker N] (worktree: .anvil/worktrees/task-00N/)
       |
       +---> [Merge Engine]     --> merges completed worktree branches into main
       |
       +---> [Sub-Judge Panel]  --> mechanical checks (tsc, lint, test, touch map)
       |
       +---> [High Court]       --> AI-powered architectural review (once at end)
       |
       +---> [Librarian]        --> doc generation from build artifacts
       |
       +---> [Cost Auditor]     --> token/cost tracking across all agents
       |
       v
  .anvil/ folder with audit trail, cost report, generated docs
```

### Component Boundaries

| Component | Responsibility | Communicates With | I/O |
|-----------|---------------|-------------------|-----|
| **CLI** | Parse commands, display progress, handle signals | Orchestrator | stdin/stdout/stderr |
| **Orchestrator** | State machine driving the pipeline; owns session state | All components | Reads/writes `.anvil/state.json` |
| **Planner Station** | Analyze user spec, produce task DAG with touch maps | Orchestrator, Anthropic API | Receives spec string, returns `Plan` JSON |
| **Wave Scheduler** | Topological sort of task DAG into execution waves | Orchestrator | Receives Plan, returns `Wave[]` |
| **Worker Pool** | Manage concurrent Worker lifecycles (spawn, monitor, collect) | Orchestrator, Workers | Manages concurrency limit (default 4) |
| **Worker** | Execute a single task in an isolated git worktree | Worker Pool, Anthropic API, git | Reads task spec, writes code + atomic commits |
| **Worktree Manager** | Create, list, merge, and clean up git worktrees | Worker Pool, Merge Engine | Wraps `simple-git` raw worktree commands |
| **Merge Engine** | Merge completed worktree branches back to main branch | Orchestrator, Worktree Manager | Operates after each wave completes |
| **Sub-Judge Panel** | Run mechanical checks in parallel after each wave merge | Orchestrator | Receives merged codebase, returns `SubJudgeReport[]` |
| **High Court** | AI-powered architectural review at end of all waves | Orchestrator, Anthropic API | Reads handoffs + code (if escalated), returns verdict |
| **Librarian** | Generate docs (README, ARCHITECTURE, OpenAPI) | Orchestrator | Reads final codebase, writes doc files |
| **Cost Auditor** | Track tokens/costs per agent per wave | All API-calling components | Accumulates usage data, writes cost report |
| **Human Escalation** | Handle PLAN_AMBIGUOUS and PLAN_GAP halts | Orchestrator, CLI | Pauses pipeline, prompts user, resumes |

### Data Flow

**Phase 1: Planning**
```
User spec (string)
  --> Orchestrator
  --> Planner Station (Anthropic API call)
  --> Plan { tasks[], touchMaps, dependencyGraph }
  --> Wave Scheduler (Kahn's algorithm)
  --> Wave[] (ordered groups of parallelizable tasks)
```

**Phase 2: Execution (per wave)**
```
Wave N tasks
  --> Worker Pool spawns Workers (up to concurrency limit)
  --> Each Worker:
      1. Worktree Manager creates worktree + branch
      2. Worker reads task spec (writes[], reads[], acceptance_criteria)
      3. Worker calls Anthropic API to generate code
      4. Touch map enforcement: only declared files writable
      5. Atomic commit(s) in worktree branch
      6. Worker produces Handoff { summary, filesChanged, concerns }
  --> All Workers in wave complete
  --> Merge Engine merges all wave branches into main
  --> Sub-Judge Panel runs checks on merged main:
      - TypeScript compilation (tsc --noEmit)
      - Lint (if configured)
      - Test runner (if tests exist)
      - Touch map compliance (diff against declared writes)
      - Security scan (optional)
  --> Sub-Judge Reports collected
  --> If any FAIL: Orchestrator decides retry/abort/escalate
  --> Wave N+1 begins from updated main
```

**Phase 3: Review**
```
All waves complete
  --> High Court receives:
      - All Worker Handoffs (summaries first, not code)
      - Sub-Judge Reports from each wave
      - Project spec for reference
  --> High Court verdict: MERGE | HUMAN_REQUIRED | ABORT
  --> If MERGE: proceed to Librarian
  --> If HUMAN_REQUIRED: pause, show concerns, await human input
```

**Phase 4: Finalization**
```
Librarian generates docs from final codebase
Cost Auditor writes session summary
Orchestrator writes final state to .anvil/
CLI reports completion
```

## Patterns to Follow

### Pattern 1: Station Pattern (Command + Handler)

Each "station" (Planner, Worker, Sub-Judge, High Court, Librarian) is a self-contained module with a uniform interface. This makes the pipeline composable and testable.

**What:** Every station implements a common interface: receive typed input, produce typed output, report cost.
**When:** Every agent role in the system.
**Why:** Testable in isolation. The Orchestrator doesn't need to know station internals.

```typescript
interface Station<TInput, TOutput> {
  name: string;
  execute(input: TInput, context: SessionContext): Promise<StationResult<TOutput>>;
}

interface StationResult<T> {
  output: T;
  usage: TokenUsage;      // for Cost Auditor
  handoff?: Handoff;       // optional summary for downstream
  escalation?: Escalation; // PLAN_AMBIGUOUS or PLAN_GAP
}
```

### Pattern 2: Immutable State Snapshots

**What:** Session state is append-only. Each state transition creates a new snapshot written to `.anvil/state.json`. Previous states are preserved in `.anvil/history/`.
**When:** Every orchestrator state transition.
**Why:** Enables resume after crash, full audit trail, debugging. Prevents partial-state corruption.

```typescript
interface SessionState {
  id: string;
  status: 'planning' | 'executing' | 'reviewing' | 'finalizing' | 'complete' | 'failed' | 'paused';
  currentWave: number;
  plan: Plan | null;
  waves: WaveState[];
  judgments: SubJudgeReport[];
  verdict: HighCourtVerdict | null;
  cost: CostSummary;
  timestamp: string;
}
```

### Pattern 3: Worktree Lifecycle Management

**What:** Git worktrees are created at task start and cleaned up after merge. Each gets a deterministic branch name.
**When:** Worker Pool creates worktrees for each wave's tasks.
**Why:** Isolation without Docker overhead. Deterministic naming enables resume.

```typescript
// Worktree lifecycle per task:
// 1. CREATE: git worktree add .anvil/worktrees/task-{id} -b anvil/task-{id}
// 2. WORK:   Worker operates in worktree directory
// 3. COMMIT: Atomic commits in worktree branch
// 4. MERGE:  git merge anvil/task-{id} (into main, after wave completes)
// 5. CLEAN:  git worktree remove .anvil/worktrees/task-{id}

// simple-git does NOT have native worktree methods.
// Use git.raw() for all worktree operations:
await git.raw(['worktree', 'add', worktreePath, '-b', branchName]);
await git.raw(['worktree', 'remove', worktreePath]);
```

### Pattern 4: Wave-Based Topological Execution

**What:** Kahn's algorithm groups tasks into waves. Tasks in the same wave have no inter-dependencies and execute in parallel. Waves execute sequentially.
**When:** After Planner produces the dependency graph.
**Why:** Eliminates merge conflicts by construction. Simpler than real-time conflict detection.

```typescript
function scheduleWaves(tasks: Task[]): Wave[] {
  // Kahn's algorithm variant:
  // 1. Compute in-degree for each task
  // 2. Wave 0 = all tasks with in-degree 0
  // 3. Remove Wave 0 tasks, decrement dependents' in-degrees
  // 4. Wave 1 = new zero in-degree tasks
  // 5. Repeat until all tasks scheduled
  // 6. If tasks remain with non-zero in-degree: cycle detected (error)
}
```

### Pattern 5: Touch Map Enforcement

**What:** Each task declares which files it may write (`writes[]`) and read (`reads[]`). The Planner guarantees no overlapping writes within a wave. Workers are prevented from writing undeclared files.
**When:** Before and after Worker execution.
**Why:** Prevents accidental conflicts. Makes merges deterministic. Core Forge principle.

```typescript
interface Task {
  id: string;
  description: string;
  writes: string[];        // files this task may create/modify
  reads: string[];         // files this task may read (but not modify)
  dependsOn: string[];     // task IDs that must complete first
  acceptanceCriteria: string[];
}
```

### Pattern 6: Handoff-First Review

**What:** High Court reads Worker summaries (handoffs) first, only diving into code when summaries raise concerns. Sub-Judges handle mechanical verification.
**When:** End of build.
**Why:** Cheaper and faster. Most issues are caught by Sub-Judges mechanically. High Court adds architectural judgment.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Shared Mutable State Between Workers
**What:** Workers reading/writing a shared state file or database during execution.
**Why bad:** Race conditions, non-deterministic results, impossible to debug.
**Instead:** Workers are fully isolated in worktrees. Communication only through Orchestrator after wave completion.

### Anti-Pattern 2: LLM-Powered Sub-Judges
**What:** Using AI calls for mechanical checks (does it compile? do tests pass?).
**Why bad:** Expensive, non-deterministic, slower than running the actual tool.
**Instead:** Sub-Judges run real tools (tsc, jest, eslint). Deterministic pass/fail.

### Anti-Pattern 3: Per-Task Merging (Merge As You Go)
**What:** Merging each Worker's branch immediately upon completion.
**Why bad:** Later Workers in the same wave may conflict. Partial merges leave main in inconsistent state.
**Instead:** Wait for all Workers in a wave to complete, then merge all at once. Sub-Judges validate the merged result.

### Anti-Pattern 4: Monolithic Orchestrator
**What:** One giant function that handles planning, execution, review, and output.
**Why bad:** Untestable, unresumable, impossible to extend.
**Instead:** Orchestrator is a state machine that delegates to stations. Each station is independently testable.

### Anti-Pattern 5: Workers Planning Their Own Scope
**What:** Workers deciding what to build or expanding task scope beyond the plan.
**Why bad:** Breaks touch map guarantees. Creates undeclared dependencies. Violates Forge principle.
**Instead:** Workers receive a fixed task spec. If they discover the plan is wrong, they emit PLAN_GAP and halt.

## Component Build Order

The architecture has clear dependency layers. Build bottom-up:

```
Layer 0 (Foundation - no dependencies):
  - Types/schemas (Plan, Task, Wave, Reports, State)
  - Config loader
  - Logger
  - Cost tracking primitives (TokenUsage accumulator)

Layer 1 (Infrastructure - depends on Layer 0):
  - Git wrapper (simple-git + raw worktree commands)
  - Anthropic API wrapper (with token counting, retry, streaming)
  - State persistence (JSON read/write with snapshots)
  - Touch map validator

Layer 2 (Stations - depends on Layers 0-1):
  - Planner Station (API wrapper + schema validation)
  - Worker (API wrapper + git wrapper + touch map validator)
  - Sub-Judge runners (tsc, test, lint, touch map check)
  - Wave Scheduler (pure function, depends only on types)

Layer 3 (Orchestration - depends on Layers 0-2):
  - Worker Pool (manages Worker concurrency)
  - Worktree Manager (create/merge/cleanup lifecycle)
  - Merge Engine (orchestrates post-wave merging)
  - Sub-Judge Panel (runs Sub-Judges in parallel, collects reports)

Layer 4 (Review - depends on Layers 0-3):
  - High Court (API wrapper + handoff-first logic)
  - Librarian (reads codebase, generates docs)
  - Cost Auditor (aggregates all TokenUsage into report)

Layer 5 (CLI - depends on all layers):
  - CLI commands (run, status, cost, logs, resume, cancel, ship)
  - Progress display
  - Human escalation prompts
  - Signal handling (Ctrl+C graceful shutdown)
```

**Critical path for MVP:** Layers 0-1, then Planner + Worker + Wave Scheduler from Layer 2, then Worker Pool + Worktree Manager + Merge Engine from Layer 3. This gives you end-to-end execution without review. Add Sub-Judges and High Court next for quality gates.

## State Machine

The Orchestrator is a finite state machine:

```
INIT --> PLANNING --> SCHEDULING --> EXECUTING --> MERGING --> JUDGING
                                       ^            |           |
                                       |            v           |
                                       +--- (next wave) <------+
                                                                |
EXECUTING --> PAUSED (PLAN_GAP or HUMAN_REQUIRED)               |
PAUSED --> EXECUTING (after human input)                        |
                                                                v
                                                         REVIEWING (High Court)
                                                                |
                                                   +------------+------------+
                                                   |            |            |
                                                   v            v            v
                                                MERGING    HUMAN_REVIEW   ABORTED
                                                   |            |
                                                   v            v
                                              FINALIZING   PAUSED
                                                   |            |
                                                   v            v
                                               COMPLETE    FINALIZING
```

Each state transition writes a snapshot to `.anvil/state.json`, enabling crash recovery. On resume, the Orchestrator reads the last snapshot and re-enters the appropriate state.

## File System Layout

```
project-root/
  .anvil/
    state.json              # Current session state (latest snapshot)
    history/                # Previous state snapshots for audit
      state-001.json
      state-002.json
    plan.json               # Planner output
    worktrees/              # Git worktrees (temporary, cleaned after merge)
      task-001/
      task-002/
    reports/
      wave-1-subjudge.json  # Sub-Judge results per wave
      wave-2-subjudge.json
      high-court.json       # High Court verdict
    cost-report.json        # Token/cost breakdown
    audit.log               # Append-only event log
    docs/                   # Librarian output
      README.md
      ARCHITECTURE.md
```

## Scalability Considerations

| Concern | Solo dev (1-10 tasks) | Medium project (10-50 tasks) | Large project (50+ tasks) |
|---------|----------------------|------------------------------|--------------------------|
| Parallelism | 2-4 Workers per wave | 4-8 Workers per wave | 8+ Workers, may hit API rate limits |
| State size | JSON files sufficient | JSON files sufficient | Consider SQLite for audit trail |
| Worktree overhead | Negligible | ~100MB disk per worktree | Disk space monitoring needed |
| API cost | ~$0.50-2 per run | ~$5-20 per run | $20+ per run, cost auditor critical |
| Wave count | 1-3 waves | 3-8 waves | 8+ waves, resume capability important |
| Merge complexity | Trivial (no overlaps by construction) | Same (touch maps enforce) | Same (touch maps enforce) |

## Key Technical Decisions

### simple-git for Git Operations (HIGH confidence)
simple-git is the standard Node.js git library. It does NOT have native worktree methods -- use `git.raw(['worktree', ...])` for all worktree operations. This is well-documented and widely used. Consider writing a thin `WorktreeManager` class that wraps these raw calls with proper TypeScript types and error handling.

### JSON State Files Over SQLite for v1 (MEDIUM confidence)
JSON files are simpler, human-readable, and debuggable. SQLite adds query power but adds a native dependency (better-sqlite3). For v1 with <50 tasks per session, JSON is sufficient. SQLite can be added later for audit trail queries without changing the station interfaces (just the persistence layer).

### Kahn's Algorithm for Wave Scheduling (HIGH confidence)
Standard algorithm for topological sort with level detection. Well-understood, O(V+E) complexity, naturally produces wave groupings. No need for a library -- implement directly (~30 lines of TypeScript).

### Anthropic SDK Direct Over Agent Frameworks (HIGH confidence)
Anvil's agent pattern (Planner, Worker, Judge) is domain-specific and simpler than what frameworks like LangGraph/LangChain provide. The overhead of learning and adapting a framework exceeds the cost of direct API calls with structured prompts. Each station makes 1-3 API calls with specific system prompts. No need for chains, graphs, or tool-use abstractions for v1.

## Sources

- [Upsun: Git worktrees for parallel AI coding agents](https://devcenter.upsun.com/posts/git-worktrees-for-parallel-ai-coding-agents/)
- [Agent Interviews: Parallel AI Coding with Git Worktrees](https://docs.agentinterviews.com/blog/parallel-ai-coding-with-gitworktrees/)
- [DEV: How We Built True Parallel Agents With Git Worktrees](https://dev.to/getpochi/how-we-built-true-parallel-agents-with-git-worktrees-2580)
- [Microsoft Azure: AI Agent Orchestration Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [SitePoint: Agentic Design Patterns Guide 2026](https://www.sitepoint.com/the-definitive-guide-to-agentic-design-patterns-in-2026/)
- [simple-git npm](https://www.npmjs.com/package/simple-git)
- [steveukx/git-js on GitHub](https://github.com/steveukx/git-js)
- [DZone: Parallelizing Tasks with Dependencies](https://dzone.com/articles/parallelizing-tasks-with-dependencies-design-your)
- [Bruno Scheufler: Scheduling Tasks with Topological Sorting](https://brunoscheufler.com/blog/2021-11-27-scheduling-tasks-with-topological-sorting)
- [Turso: AgentFS with SQLite-backed agent state](https://turso.tech/blog/agentfs-fuse)
- [ccswarm: Multi-agent orchestration with Claude Code and git worktree isolation](https://github.com/nwiizo/ccswarm)
- [Scaling 120+ AI Agents with Two-Tier Orchestration](https://www.decodingai.com/p/scaling-120-ai-agents-two-tier-orchestration)
