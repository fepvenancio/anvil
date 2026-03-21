# Technology Stack

**Project:** Anvil -- Lightweight AI Code Factory
**Researched:** 2026-03-20

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

**Why better-sqlite3 over Node built-in SQLite:** Node's native sqlite module is still experimental (release candidate status, not stable). No async API. Missing features. better-sqlite3 is battle-tested with 12+ years of production use. Revisit when Node sqlite reaches stable.

### Concurrency Control

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| p-limit | ^6.2.0 | Parallel worker execution within waves | Lightweight (no queue abstraction needed). Anvil's wave model is simple: run N tasks concurrently, wait for all, proceed. p-limit is exactly this. 170M weekly downloads. ESM-only in v6+. | HIGH |

### Terminal UI

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| chalk | ^5.4.1 | Terminal colors | ESM-only in v5, which is fine since Anvil is ESM ("type": "module"). Widely known API, maintained. | MEDIUM |
| ora | ^8.2.0 | Spinners for long-running operations | Elegant terminal spinners. Show worker progress, wave status, LLM calls. Works with chalk. | MEDIUM |

**Alternative considered:** picocolors (7kB, CJS-only) or ansis (ESM+CJS). chalk is fine since Anvil is ESM-only and chalk's API is familiar. No need to optimize for bundle size in a CLI.

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

```bash
npm install @anthropic-ai/sdk@^0.80.0 \
  commander@^14.0.3 \
  simple-git@^3.33.0 \
  zod@^4.3.6 \
  better-sqlite3@^12.8.0 \
  p-limit@^6.2.0 \
  chalk@^5.4.1 \
  ora@^8.2.0 \
  pino@^9.6.0
```

### Dev Dependencies

```bash
npm install -D typescript@^5.8.0 \
  tsx@^4.19.0 \
  tsup@^8.5.1 \
  vitest@^4.1.0 \
  @types/better-sqlite3@^7.6.13 \
  pino-pretty@^13.0.0
```

## Version Pinning Strategy

Use caret ranges (`^`) for all dependencies. Lock file (package-lock.json) provides reproducibility. Anvil targets `npx anvil@latest` so users always get latest compatible versions.

## ESM Strategy

Anvil is ESM-only (`"type": "module"` in package.json). This aligns with:
- chalk 5 (ESM-only)
- p-limit 6 (ESM-only)
- ora 8 (ESM-only)
- Node 22 native ESM support
- TypeScript `"module": "node16"` or `"nodenext"` in tsconfig

No CJS compatibility layer needed. CLI tools don't need to support CJS consumers.

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
