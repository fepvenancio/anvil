# Anvil Tier 2 Roadmap — From "Best Generator" to "Real Tool"

Written after a 35+ commit session that took Anvil from v0.1.12 (Wave 3 always fails) to v0.7.0 (auth API with 32 tests, self-audit, 5 judges). This document is honest about where Anvil is, what's hard, and what's achievable.

## Where We Are (v0.7.0)

**What works reliably:**
- Greenfield TypeScript projects up to ~12 tasks / 8 waves
- Senior-level code output (global error handlers, config modules, Zod validation, 15-30 tests)
- 5 sub-judges (tsc, vitest, touch-map, security, interface) + High Court
- Wave retry loop (2x with error context)
- Scaffold pre-flight (skip judges on config-only wave)
- Auto-fix dependency chains in plans
- GSD-inspired project scanner for brownfield detection
- Claude Code skill (`/anvil:run`)

**What fails intermittently:**
- Complex specs with 15+ tasks (planner quality degrades)
- Parallel waves with merge conflicts (retry usually fixes it)
- Specs that need native npm packages (bcrypt, sharp, etc.)

**What doesn't work at all:**
- Editing existing codebases (brownfield modification)
- Fixing bugs in existing code
- Non-TypeScript stacks (Python/Go presets exist in prompts but never benchmarked)
- Projects that need databases, external APIs, or runtime services

## The Three Walls to Tier 2

### Wall 1: Brownfield Editing (hardest, highest impact)

**The problem:** Anvil can only create new projects. It can't `anvil run "Add auth to this Express app"` on an existing codebase. This eliminates 80% of real-world use cases.

**Why it's hard:**
- The planner generates a full task list assuming empty directory
- Workers create files from scratch — they don't know how to edit existing files
- The write-overlap validator prevents two tasks from touching the same file
- The touch-map judge blocks any file modification not in task.writes[]

**What needs to change:**

1. **Plan types: "create" vs "modify"**
   - `src/schemas/plan.ts` needs a task `action` field: `'create' | 'modify' | 'delete'`
   - "modify" tasks use `Edit` tool instead of `Write`
   - The write-overlap validator allows multiple "modify" tasks on the same file IF they edit different sections

2. **Planner reads the codebase**
   - The GSD-inspired scanner (planner.ts `_detectProjectContext`) is a start but it's passive — it just injects text into the prompt
   - The planner needs actual tools: `Read`, `Glob`, `Grep` — let it explore before planning
   - This means changing `tools: []` in planner.ts to `tools: ['Read', 'Glob', 'Grep']` and increasing `maxTurns` from 3 to 10
   - Risk: planner might explore too much and burn tokens. Add a token budget.

3. **Workers use Edit, not just Write**
   - Currently workers use the Claude Agent SDK with preset tools
   - For "modify" tasks, workers need to read the existing file, understand it, and make targeted edits
   - This is fundamentally harder than creating files from scratch — the worker needs to understand existing patterns, not just follow the plan's description

4. **Touch-map judge for modifications**
   - Current touch-map checks: "did you create files outside your writes[]?"
   - For modifications: "did you change lines outside the described scope?"
   - This needs a diff-based check: worker can only change lines related to the task description

**Estimated effort:** 2-3 weeks of focused work. This is the single biggest investment.

**Where to be careful:**
- Don't try to make Anvil a general-purpose code editor. Keep it task-based: "Add feature X" or "Refactor Y" — not "fix all the bugs."
- The planner-with-tools approach will be expensive. Budget 5K-10K tokens for exploration, then generate the plan.
- Merge conflicts become much more likely with modify tasks. The retry loop needs to handle file-level conflicts, not just branch-level.

### Wall 2: Reliability on First Try

**The problem:** The auth benchmark took 5 iterations of fixing Anvil itself before it passed. Real users won't iterate 5 times — they'll give up after 1 failure.

**What causes first-try failures (from our benchmark data):**

| Failure | Frequency | Root Cause | Fix Status |
|---------|-----------|-----------|------------|
| Scaffold writes source files | High | Planner ignores scaffold rules | Fixed (v0.5.0) |
| Missing @types/node | High | Not in planner instructions | Fixed (v0.2.0) |
| npm audit blocks build | High | Common packages have CVEs | Fixed (v0.6.0) |
| Export name descriptions | Medium | Planner puts "default (auth router)" | Fixed (v0.6.0) |
| vitest config mismatch | Medium | Config doesn't include tests/ | Fixed (v0.6.0) |
| bcrypt native binding | Medium | --ignore-scripts skips compilation | Fixed (v0.6.0) |
| tsc on scaffold-only wave | Medium | No .ts files yet | Fixed (v0.3.1) |
| CORS rule too strict | Low | cors() without args flagged | Fixed (v0.4.1) |
| innerHTML in .html files | Low | Security rule too aggressive | Fixed (v0.4.1) |
| Parallel merge conflicts | Low | Two tasks modify related files | Partially fixed (abort early) |

**What needs to change:**

1. **Run the benchmark suite on every commit**
   - Create `benchmarks/` directory with 5 fixed specs (calculator, books API, todo app, auth API, finance API)
   - CI runs all 5 on every PR. If any fail, PR is blocked.
   - This prevents regressions. Half our session was re-fixing things that broke between versions.

2. **Planner output validation needs to be stricter**
   - The auto-fixer silently moves files between tasks. This can create plans that don't match what the planner intended.
   - Better: reject bad plans and retry with specific feedback, rather than silently fixing them.
   - The current `_autoFixDependencies` is a band-aid. The planner should generate correct plans.

3. **Worker self-verification needs to actually block**
   - The worker prompt says "run tsc and vitest before declaring complete" but the worker is a Claude Code agent — it decides whether to listen.
   - We can't force it. But we can check: if the worker declares success but the sub-judges fail, the retry context should say "YOU claimed success but tsc found errors. This means you didn't run tsc --noEmit before finishing."

4. **Reduce the number of things that can go wrong**
   - Every npm install is a failure point. We cut it from 20+ to ~3 per build (v0.7.0). Could be 1.
   - Every LLM call is non-deterministic. We removed the plan-critic LLM call (v0.7.0). High Court is the only "optional" LLM call left.
   - Every git operation can fail. Worktree creation, merging, cleanup — each is a crash point.

**Estimated effort:** 1-2 weeks for benchmark CI + planner improvements.

**Where to be careful:**
- Don't over-validate. Every check we add is a potential false positive. The self-improvement loop showed that 3 out of 8 self-audit findings were wrong.
- The retry loop already handles most transient failures. Focus on eliminating root causes, not adding more retries.

### Wall 3: Multi-Language Support

**The problem:** Anvil claims Python, Go, and React presets but has never successfully built a project in any of them.

**What needs to change:**

1. **Benchmark each stack preset**
   - Python: "Build a FastAPI todo API with pytest tests"
   - Go: "Build a Chi HTTP server with stdlib tests"
   - React: "Build a Vite + React calculator app"
   - Run each until it passes, fixing issues as they appear (same self-improvement loop)

2. **Stack-specific judges**
   - Python: replace tsc judge with `mypy --strict` or `ruff check`
   - Go: replace tsc with `go build` and `go vet`
   - React: add `vite build` check
   - The judge panel needs to be stack-aware (currently hardcoded for TypeScript)

3. **Stack-specific worker prompts**
   - The senior patterns in worker-system.ts are TypeScript-specific (Express, Zod, supertest)
   - Python workers need different patterns (FastAPI, Pydantic, httpx for testing)
   - Go workers need Go conventions (error returns, short variables, stdlib testing)

**Estimated effort:** 1 week per stack (benchmark + fix loop).

**Where to be careful:**
- Don't try to support every language. TypeScript is the sweet spot for AI code generation (94% of compilation errors caught by type system). Python and Go are the most requested alternatives.
- Each language has its own ecosystem of build tools, test runners, and linters. The judge system needs to be pluggable, not hardcoded.

## What NOT to Build

Based on our research (5 agents analyzed token math, cost, quality, architecture, and competitive landscape):

1. **Don't build a TUI dashboard** — chalk + ora is fine. A full terminal UI (ink, blessed) adds complexity for minimal user value. GSD uses plain text banners and it works.

2. **Don't add more LLM review stages** — We had Plan-Critic (LLM) and removed it because it was redundant. The research showed security degrades after 3 LLM iterations (IEEE ISTAS 2025). More LLM review ≠ better code.

3. **Don't chase SWE-bench** — Anvil's use case (greenfield project generation) isn't measured by SWE-bench (single-issue bug fixes). Building a SWE-bench harness would distract from real improvements.

4. **Don't add multi-provider support** — Claude-only is correct for v1. The research showed model-specific prompt engineering beats generic prompts. Adding OpenAI/Gemini support would dilute quality.

5. **Don't build a web UI** — Anvil's value is `npx anvil-ai run "..."` — zero setup. A web UI adds hosting, auth, state management. That's a different product (bolt.new, Lovable).

## Priority Order

| Phase | What | Effort | Impact | Depends On |
|-------|------|--------|--------|------------|
| **1** | Benchmark CI (5 specs, run on every commit) | 1 week | Prevents regressions | Nothing |
| **2** | Python + Go stack support (benchmark + fix loop) | 2 weeks | Doubles addressable market | Phase 1 |
| **3** | Brownfield editing ("modify" task type) | 3 weeks | 5x use case expansion | Phase 1 |
| **4** | Planner with tools (Read, Glob, Grep) | 1 week | Better plans for brownfield | Phase 3 |
| **5** | Prompt caching optimization | 3 days | 40% cost reduction | Nothing |
| **6** | `anvil fix` command (re-run failed wave only) | 3 days | Better DX on failures | Nothing |

## The Honest Path to Tier 2

Anvil reaches Tier 2 when:
1. Auth API benchmark passes on first try, 10 out of 10 runs ← **we're close (6th iteration passed)**
2. Brownfield editing works for "add a feature" specs ← **not started**
3. At least 2 non-TypeScript stacks benchmarked and passing ← **not started**
4. CI benchmark suite prevents regressions ← **not started**

Realistic timeline: **6-8 weeks of focused work.**

The competitive moat isn't speed or cost — Claude Code will always be faster and cheaper for simple tasks. The moat is **reviewed, audited, tested output with clean git history.** That matters for teams shipping to production, and it's something no Tier 1 tool currently offers.

## Session Stats

- **Commits:** 35+
- **Versions:** v0.1.12 → v0.7.0
- **Benchmarks passed:** Calculator, Books API (x2), Todo (full-stack), Auth API
- **Self-improvement iterations:** 6 (5 bugs found and fixed)
- **Research agents:** 5 (token math, cost model, quality research, architecture audit, competitive landscape)
- **Gemini debate:** 3 findings implemented (lockfile lock, judge race, InterfaceJudge)
- **KAM codebase analysis:** 2 agents (backend + frontend patterns extracted)
- **Self-audit findings:** 5 real fixes, 3 false positives rejected
- **Final benchmark:** Auth API — 12 tasks, 8 waves, 32 tests, $1.25, all judges pass
