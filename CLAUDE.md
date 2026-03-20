You are building Anvil — the simplified, GSD-native version of the original Forge.

Strict rules:
- Stay pure TypeScript. No Docker, no Python, no Dolt.
- Use git worktrees for every Worker task.
- Planner NEVER writes code. Workers NEVER plan.
- Keep the exact Forge review system (Sub-Judges + High Court).
- Every change = atomic commit with clear message.
- Update STATE.md and ROADMAP.md after each wave.
- When in doubt, reference the original Forge agent roles and XML formats but make it 5× lighter.

Start every response with current wave number.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**Anvil — Lightweight AI Code Factory**

Anvil is a pure TypeScript CLI that orchestrates a team of AI agents to build entire projects from a single natural-language command. It's the spiritual successor to [Forge](https://github.com/fepvenancio/forge) — same structured agent roles (Planner, Workers, Sub-Judges, High Court, Librarian, Cost Auditor), same review rigor, but radically simplified: no Docker, no Python, no Dolt, no monorepo. One command, zero setup.

Target user: solo devs who loved Forge's power but hated the 40GB RAM / Docker / Python gate setup.

**Core Value:** `npx anvil run "Build X"` produces a complete, reviewed, production-ready project with clean git history and full audit trail — in under 5 minutes, with zero manual setup.

### Constraints

- **Tech stack**: Pure TypeScript, Node 22+, @anthropic-ai/sdk, simple-git, commander. No Docker, no Python, no Dolt.
- **Installation**: Must work via `npx anvil@latest run "..."` — zero prerequisites beyond Node 22
- **State**: JSON files + optional SQLite (better-sqlite3) for audit trail. No external databases.
- **Model**: Anthropic Claude only (claude-3-7-sonnet as default). No multi-provider abstraction for v1.
- **Parallelism**: Default 4 parallel workers. Configurable via CLI flag.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Runtime
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | >=22 LTS | Runtime | Already specified in constraints. Required for modern ESM, top-level await, native test runner fallback. Node 22 is current LTS. | HIGH |
| TypeScript | ^5.8 | Type system | Use 5.8 (latest stable in 5.x line). TS 6.0 RC just dropped (March 2026) but is the *last* JS-based compiler -- avoid until stable. Do NOT adopt TS 7 (Go-based) yet; it is experimental. | HIGH |
### CLI Framework
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| commander | ^14.0.3 | CLI parsing | Already in package.json. 14.x is current stable (15 planned May 2026). Mature, well-typed, 121k dependents. No reason to switch. | HIGH |
### AI / LLM
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @anthropic-ai/sdk | ^0.80.0 | Claude API client | Official Anthropic SDK. v0.80.0 is current. Supports tool_use, structured outputs (output_config.format -- no beta header needed), extended thinking with interleaved reasoning, and streaming. Bump from ^0.32.0 in current package.json. | HIGH |
### Git Operations
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| simple-git | ^3.33.0 | Git worktree management, commits, merges | Already in package.json. v3.33.0 is current (published 10 days ago). Mature, typed, supports worktree add/remove/list, branch operations, merge. Sufficient for all Anvil git needs. | HIGH |
### Schema Validation
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| zod | ^4.3.6 | Runtime validation of plans, agent outputs, configs | Zod 4 is current stable. TypeScript-first with static type inference. Use at trust boundaries: LLM output parsing, plan schema validation, config loading. Generates types from schemas -- single source of truth. | HIGH |
### Database / State
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| better-sqlite3 | ^12.8.0 | Audit trail, cost tracking, session state | Synchronous API (perfect for CLI -- no async overhead for simple writes). v12.8.0 is current, actively maintained, supports Node 22. Native addon requires build tools but prebuilt binaries cover common platforms. | HIGH |
| JSON files | N/A | Plan storage, config, lightweight state | For human-readable artifacts (.anvil/plan.json, config). No dependency needed -- use fs/promises + zod for validation. | HIGH |
### Concurrency Control
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| p-limit | ^6.2.0 | Parallel worker execution within waves | Lightweight (no queue abstraction needed). Anvil's wave model is simple: run N tasks concurrently, wait for all, proceed. p-limit is exactly this. 170M weekly downloads. ESM-only in v6+. | HIGH |
### Terminal UI
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| chalk | ^5.4.1 | Terminal colors | ESM-only in v5, which is fine since Anvil is ESM ("type": "module"). Widely known API, maintained. | MEDIUM |
| ora | ^8.2.0 | Spinners for long-running operations | Elegant terminal spinners. Show worker progress, wave status, LLM calls. Works with chalk. | MEDIUM |
### Logging
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| pino | ^9.6.0 | Structured JSON logging to audit files | Fast, structured JSON output by default. Perfect for .anvil/logs/ audit trail. Use pino for file logging, chalk+ora for terminal output. Separate concerns: user-facing vs machine-readable. | HIGH |
### Build Tooling
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| tsup | ^8.5.1 | Bundle for npm distribution | Zero-config bundler over esbuild. Produces ESM output, generates .d.ts, handles shebang for CLI bin. Note: tsup is in maintenance mode (maintainer recommends tsdown) but 8.5.1 is stable and widely used. Switch to tsdown when it matures. | MEDIUM |
| tsx | ^4.19.0 | Dev-time execution | Already in package.json. Runs .ts files directly without build step. Keep for `npm run dev`. | HIGH |
### Testing
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| vitest | ^4.1.0 | Unit and integration tests | Native TypeScript support, Jest-compatible API, fast. Vitest 4.x is current stable. Use for testing orchestration logic, plan validation, git operations (with temp dirs). | HIGH |
### Event System
| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node EventEmitter | built-in | Internal event bus for orchestrator | No external dependency needed. Node's built-in EventEmitter with TypeScript generics (via typed-emitter pattern or manual typing) is sufficient for wave lifecycle events, worker status updates, judge results. | HIGH |
## What NOT to Use
| Technology | Why Not |
|------------|---------|
| LangChain / LangGraph | Massive dependency, Python-first mindset, unnecessary abstraction. Anvil calls Claude directly via SDK. |
| Vercel AI SDK (@ai-sdk/*) | Adds provider abstraction Anvil doesn't need (Claude-only). Extra dependency for no benefit. |
| Docker / containers | Explicitly out of scope. Git worktrees provide sufficient isolation. |
| Prisma / Drizzle / any ORM | Overkill for a few audit tables. Raw better-sqlite3 with typed helpers is simpler. |
| inquirer / prompts | Anvil is non-interactive (single command). Use commander for args, not interactive prompts. |
| ink (React for CLI) | Over-engineered for Anvil's output needs. chalk + ora covers progress display. |
| winston | Slower than pino, more config. Pino's JSON-by-default is better for audit logs. |
| Node built-in sqlite | Still experimental. Not production-ready. Use better-sqlite3. |
| TypeScript 6.0 / 7.0 | 6.0 is RC (not stable). 7.0 is Go-based experimental rewrite. Stay on 5.8. |
| p-queue | More features than needed (priorities, pause). p-limit's simpler model fits wave execution. |
| nanoid / uuid | Node 22 has crypto.randomUUID() built-in. No dependency needed for IDs. |
## Full Dependency List
### Production Dependencies
### Dev Dependencies
## Version Pinning Strategy
## ESM Strategy
- chalk 5 (ESM-only)
- p-limit 6 (ESM-only)
- ora 8 (ESM-only)
- Node 22 native ESM support
- TypeScript `"module": "node16"` or `"nodenext"` in tsconfig
## Sources
- [@anthropic-ai/sdk on npm](https://www.npmjs.com/package/@anthropic-ai/sdk) -- v0.80.0 current
- [simple-git on npm](https://www.npmjs.com/package/simple-git) -- v3.33.0 current
- [commander on npm](https://www.npmjs.com/package/commander) -- v14.0.3 current
- [better-sqlite3 on npm](https://www.npmjs.com/package/better-sqlite3) -- v12.8.0 current
- [zod on npm](https://www.npmjs.com/package/zod) -- v4.3.6 current
- [Zod v4 release notes](https://zod.dev/v4)
- [p-limit on npm](https://www.npmjs.com/package/p-limit) -- 170M weekly downloads
- [Vitest 4.0 announcement](https://www.infoq.com/news/2025/12/vitest-4-browser-mode/)
- [TypeScript 6.0 RC announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-rc/)
- [Node.js SQLite docs](https://nodejs.org/api/sqlite.html) -- still experimental
- [Anthropic structured outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [tsup on npm](https://www.npmjs.com/package/tsup) -- v8.5.1, maintenance mode
- [Ansis as chalk alternative](https://github.com/webdiscus/ansis)
- [Pino logger](https://betterstack.com/community/guides/logging/how-to-install-setup-and-use-pino-to-log-node-js-applications/)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
