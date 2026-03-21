# Phase 1: Foundation - Research

**Researched:** 2026-03-21
**Domain:** TypeScript CLI scaffold, Zod schema design, file system infrastructure
**Confidence:** HIGH

## Summary

Phase 1 builds the foundation everything else rests on: a runnable CLI entry point, all core Zod schemas, the `.anvil/` directory structure, and plan validation. This is a greenfield phase with no existing source code -- the `src/` directory is empty.

The work breaks into four clear areas: (1) project scaffolding (tsconfig, package.json updates, directory structure), (2) Zod schema definitions for all core types, (3) CLI entry point with commander that prints config and exits, and (4) `.anvil/` folder initialization with plan validation logic. All dependencies are well-understood, all APIs are stable, and the stack research from STACK.md provides verified library choices.

**Primary recommendation:** Build schemas first (they are imported everywhere), then the config loader, then the `.anvil/` initializer, then the CLI entry point that ties it together. Use Zod 4's `z.toJSONSchema()` for plan validation so the same schema definition serves both TypeScript types and JSON validation.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLI-05 | CLI prints config summary on startup (project name, model, max workers) | Commander 14 subcommand pattern; config type with defaults; chalk for formatted output |
| PLAN-04 | Plan is validated against a JSON schema before execution begins | Zod 4 schemas with `.parse()` / `.safeParse()` for validation; `z.toJSONSchema()` for JSON Schema export |
| PLAN-06 | Plan is saved to `.anvil/roadmap.json` for inspection | `.anvil/` directory initializer; JSON file write utility with Zod-validated types |
| CLUX-04 | `.anvil/` folder contains full audit trail: plan, wave reports, judge verdicts, cost summary | Directory structure creation: `logs/`, `reports/`, `history/`; placeholder files for roadmap.json |
</phase_requirements>

## Standard Stack

### Core (Phase 1 Dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.8 (latest: 5.9.3) | Type system + compilation | Stable 5.x line. 5.9.3 is latest on npm. Avoid 6.0 RC / 7.0 experimental. |
| zod | ^4.3.6 | Schema definitions, runtime validation, type inference | Zod 4 stable. Single source of truth for types + validation. `z.toJSONSchema()` built-in. |
| commander | ^14.0.3 | CLI argument parsing, subcommands | 14.x is current stable. Well-typed, ESM-compatible. |
| chalk | ^5.6.2 | Terminal color output | ESM-only in v5. For config summary display. Latest is 5.6.2. |
| pino | ^9.6.0 (latest: 10.3.1) | Structured JSON logging | For `.anvil/logs/` audit trail. Note: 10.x is now available; use ^9.6.0 per STACK.md or bump to ^10.3.1. |

### Dev Dependencies

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsx | ^4.21.0 | Dev-time TypeScript execution | `npm run dev` during development |
| tsup | ^8.5.1 | Bundle for distribution | `npm run build` for dist/ output |
| vitest | ^4.1.0 | Testing | Schema validation tests, CLI smoke tests |
| @types/node | ^22 | Node.js type definitions | TypeScript compilation |

### Not Needed in Phase 1

| Library | Why Deferred |
|---------|-------------|
| @anthropic-ai/sdk | No LLM calls in Phase 1 (schemas + CLI only) |
| simple-git | No git operations in Phase 1 |
| better-sqlite3 | No database in Phase 1 (JSON files only) |
| p-limit | No parallel execution in Phase 1 |
| ora | No spinners needed yet (print and exit) |

**Installation (Phase 1 only):**
```bash
npm install zod@^4.3.6 commander@^14.0.3 chalk@^5.6.2 pino@^9.6.0

npm install -D typescript@^5.8.0 tsx@^4.21.0 tsup@^8.5.1 vitest@^4.1.0 @types/node@^22 pino-pretty@^13.0.0
```

**Version verification (2026-03-21):**
| Package | Registry Version | Recommended |
|---------|-----------------|-------------|
| zod | 4.3.6 | ^4.3.6 |
| commander | 14.0.3 | ^14.0.3 |
| chalk | 5.6.2 | ^5.6.2 |
| pino | 10.3.1 | ^9.6.0 or ^10.3.1 |
| typescript | 5.9.3 | ^5.8.0 |
| tsx | 4.21.0 | ^4.21.0 |
| tsup | 8.5.1 | ^8.5.1 |
| vitest | 4.1.0 | ^4.1.0 |

## Architecture Patterns

### Recommended Project Structure

```
src/
  cli.ts                  # CLI entry point (commander setup, bin target)
  index.ts                # Library entry point (re-exports)
  schemas/
    plan.ts               # Plan, Task schemas
    wave.ts               # Wave, WaveState schemas
    session.ts            # SessionState schema
    reports.ts            # SubJudgeReport, HighCourtReport, CostReport schemas
    config.ts             # AnvilConfig schema with defaults
    index.ts              # Re-exports all schemas + inferred types
  core/
    anvil-dir.ts          # .anvil/ directory initializer
    config-loader.ts      # Load config from .anvilrc / defaults
    logger.ts             # Pino logger factory (file + console transports)
    validator.ts          # Plan validation using Zod schemas
  types.ts                # Inferred types from Zod schemas (re-export convenience)
```

### Pattern 1: Zod Schema as Single Source of Truth

**What:** Define all data structures as Zod schemas. Infer TypeScript types from them. Never manually define interfaces that duplicate schema structure.
**When:** Every data type in the system.
**Why:** One definition produces both runtime validation and compile-time types. Eliminates type/validation drift.

```typescript
// src/schemas/plan.ts
import { z } from 'zod/v4';

export const TaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  writes: z.array(z.string()),
  reads: z.array(z.string()),
  dependsOn: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
});

export const PlanSchema = z.object({
  id: z.string(),
  spec: z.string(),
  tasks: z.array(TaskSchema),
  createdAt: z.string().datetime(),
});

// Infer types -- never hand-write these interfaces
export type Task = z.infer<typeof TaskSchema>;
export type Plan = z.infer<typeof PlanSchema>;
```

### Pattern 2: Config with Defaults via Zod

**What:** Define config schema with `.default()` on every field. Parse empty object to get full defaults. Parse partial user config to merge with defaults.
**When:** Loading `.anvilrc` or CLI flags.

```typescript
export const AnvilConfigSchema = z.object({
  projectName: z.string().default('anvil-project'),
  model: z.string().default('claude-sonnet-4-20250514'),
  maxWorkers: z.number().int().min(1).max(16).default(4),
  anvilDir: z.string().default('.anvil'),
});

export type AnvilConfig = z.infer<typeof AnvilConfigSchema>;

// Usage: get defaults
const config = AnvilConfigSchema.parse({});
// Usage: merge user config
const config = AnvilConfigSchema.parse(userPartialConfig);
```

### Pattern 3: Directory Initializer Pattern

**What:** A single function that ensures `.anvil/` exists with all expected subdirectories and placeholder files. Idempotent -- safe to call multiple times.
**When:** On every `anvil run` invocation, before any other operation.

```typescript
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export async function initAnvilDir(root: string): Promise<void> {
  const anvilDir = join(root, '.anvil');
  const dirs = ['logs', 'reports', 'history', 'worktrees'];

  // Create all directories (recursive, idempotent)
  for (const dir of dirs) {
    await mkdir(join(anvilDir, dir), { recursive: true });
  }

  // Create placeholder roadmap.json if not exists
  const roadmapPath = join(anvilDir, 'roadmap.json');
  try {
    await access(roadmapPath);
  } catch {
    await writeFile(roadmapPath, JSON.stringify({ plan: null }, null, 2));
  }
}
```

### Pattern 4: CLI Entry Point with Commander

**What:** Single `cli.ts` that sets up commander with subcommands. Each subcommand is a thin wrapper that calls into core modules.
**When:** The `anvil` binary entry point.

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { AnvilConfigSchema } from './schemas/config.js';
import { initAnvilDir } from './core/anvil-dir.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('anvil')
  .description('Lightweight AI Code Factory')
  .version('0.1.0');

program
  .command('run')
  .description('Start a build from a natural-language spec')
  .argument('<spec>', 'What to build')
  .option('-w, --workers <n>', 'Max parallel workers', '4')
  .option('-m, --model <model>', 'Claude model to use')
  .action(async (spec: string, opts: Record<string, string>) => {
    const config = AnvilConfigSchema.parse({
      maxWorkers: opts.workers ? parseInt(opts.workers, 10) : undefined,
      model: opts.model,
    });

    await initAnvilDir(process.cwd());

    // CLI-05: Print config summary
    console.log(chalk.bold('Anvil'));
    console.log(`  Project:     ${config.projectName}`);
    console.log(`  Model:       ${config.model}`);
    console.log(`  Max Workers: ${config.maxWorkers}`);
    console.log(`  Spec:        ${spec}`);
  });

await program.parseAsync();
```

### Anti-Patterns to Avoid

- **Hand-written interfaces duplicating Zod schemas:** Always use `z.infer<typeof Schema>`. Never define a `Plan` interface separately from `PlanSchema`.
- **Deep nesting in schemas/:** Keep it flat. One file per domain (plan, wave, session, reports, config). No subdirectories within schemas/.
- **Lazy validation (validate only when needed):** Validate at EVERY boundary: file read, config load, CLI input. Fail early with clear messages.
- **Mutable config object:** Config should be created once (at startup) and passed immutably to all consumers. Use `Readonly<AnvilConfig>`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema validation | Custom JSON validators | `zod.parse()` / `zod.safeParse()` | Edge cases in nested objects, arrays, unions. Zod handles error messages, type narrowing. |
| JSON Schema generation | Manual JSON Schema files | `z.toJSONSchema(PlanSchema)` | Keeps JSON Schema in sync with TypeScript types automatically. |
| CLI argument parsing | Manual process.argv parsing | `commander` | Option merging, help generation, subcommands, type coercion. |
| Directory creation | Manual mkdir chains | `fs/promises.mkdir({ recursive: true })` | Handles existing dirs, nested paths, race conditions. |
| Colored terminal output | ANSI escape codes | `chalk` | Cross-platform, detects color support, composable API. |
| Structured logging | `console.log` + manual formatting | `pino` | JSON by default, log levels, file transports, timestamps. |

**Key insight:** Phase 1 is all infrastructure plumbing. Every component has a mature, well-tested library. Zero custom algorithms needed.

## Common Pitfalls

### Pitfall 1: Zod 4 Import Path

**What goes wrong:** Using `import { z } from 'zod'` works but `import { z } from 'zod/v4'` gives access to v4-specific features like `z.toJSONSchema()`.
**Why it happens:** Zod 4 supports both import paths for backward compatibility, but some v4 features require the v4-specific import.
**How to avoid:** Use `import { z } from 'zod/v4'` consistently across all schema files. Alternatively, `import { z } from 'zod'` works for all standard operations in v4 -- only specialty features like registries need the sub-path.
**Warning signs:** `z.toJSONSchema is not a function` at runtime.

### Pitfall 2: ESM File Extensions in Imports

**What goes wrong:** TypeScript compiles but runtime fails with `ERR_MODULE_NOT_FOUND`.
**Why it happens:** ESM requires explicit `.js` extensions in imports. TypeScript does not add them during compilation.
**How to avoid:** Always use `.js` extensions in import statements: `import { foo } from './bar.js'`. Configure tsconfig with `"moduleResolution": "node16"` or `"nodenext"`.
**Warning signs:** Code compiles but crashes on first import at runtime.

### Pitfall 3: Outdated package.json Dependencies

**What goes wrong:** Current package.json has old versions (commander ^12, @anthropic-ai/sdk ^0.32, simple-git ^3.27, no zod).
**Why it happens:** Initial package.json was created before stack research.
**How to avoid:** Phase 1 must update package.json with correct dependency versions before any coding. Remove dependencies not needed in Phase 1, add missing ones.
**Warning signs:** Version mismatch errors, missing type definitions.

### Pitfall 4: Missing tsconfig.json

**What goes wrong:** TypeScript compilation fails or uses wrong settings.
**Why it happens:** No tsconfig.json exists in the project yet.
**How to avoid:** Create tsconfig.json as the very first task. Must include: `"target": "ES2022"`, `"module": "node16"`, `"moduleResolution": "node16"`, `"strict": true`, `"outDir": "dist"`, `"rootDir": "src"`.
**Warning signs:** `tsx` works but `tsc` fails (tsx is more lenient).

### Pitfall 5: Circular Schema Imports

**What goes wrong:** Schema files import each other, creating circular dependencies that cause runtime errors or incomplete types.
**Why it happens:** SessionState references Plan, Plan references Task, etc.
**How to avoid:** Use a dependency-ordered structure: base types first (Task), composites next (Plan, Wave), top-level last (SessionState). Or put all schemas in a single file if the total size is manageable (<200 lines).
**Warning signs:** `undefined` when accessing imported schema at module load time.

### Pitfall 6: Forgetting the Shebang

**What goes wrong:** `npx anvil run "test"` fails with a syntax error.
**Why it happens:** The bin entry in package.json points to `dist/cli.js` which needs `#!/usr/bin/env node` at the top.
**How to avoid:** Add the shebang to `src/cli.ts`. Configure tsup to preserve/add shebangs during bundling.
**Warning signs:** Works with `node dist/cli.js` but not via `npx` or direct binary invocation.

## Code Examples

### Zod 4 Schema with Enums and Unions

```typescript
// src/schemas/reports.ts
import { z } from 'zod';

export const SubJudgeCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  message: z.string().optional(),
  details: z.string().optional(),
});

export const SubJudgeReportSchema = z.object({
  waveNumber: z.number().int(),
  checks: z.array(SubJudgeCheckSchema),
  allPassed: z.boolean(),
  timestamp: z.string().datetime(),
});

export const HighCourtVerdictSchema = z.enum(['merge', 'human_required', 'abort']);

export const HighCourtReportSchema = z.object({
  verdict: HighCourtVerdictSchema,
  reasoning: z.string(),
  concerns: z.array(z.string()),
  invariantChecks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    detail: z.string().optional(),
  })),
  timestamp: z.string().datetime(),
});

export const CostEntrySchema = z.object({
  agent: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int().default(0),
  cacheWriteTokens: z.number().int().default(0),
  costUsd: z.number(),
});

export const CostReportSchema = z.object({
  sessionId: z.string(),
  entries: z.array(CostEntrySchema),
  totalCostUsd: z.number(),
  timestamp: z.string().datetime(),
});

// Infer all types
export type SubJudgeCheck = z.infer<typeof SubJudgeCheckSchema>;
export type SubJudgeReport = z.infer<typeof SubJudgeReportSchema>;
export type HighCourtVerdict = z.infer<typeof HighCourtVerdictSchema>;
export type HighCourtReport = z.infer<typeof HighCourtReportSchema>;
export type CostEntry = z.infer<typeof CostEntrySchema>;
export type CostReport = z.infer<typeof CostReportSchema>;
```

### Plan Validation Function

```typescript
// src/core/validator.ts
import { PlanSchema, type Plan } from '../schemas/plan.js';

export interface ValidationResult {
  valid: boolean;
  plan?: Plan;
  errors?: string[];
}

export function validatePlan(data: unknown): ValidationResult {
  const result = PlanSchema.safeParse(data);
  if (result.success) {
    return { valid: true, plan: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    ),
  };
}
```

### tsconfig.json for ESM + Node 22

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "node16",
    "moduleResolution": "node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod 3 with manual JSON Schema | Zod 4 with `z.toJSONSchema()` built-in | 2025 (Zod 4 stable) | No need for zod-to-json-schema package |
| Zod 3 string validators (.email()) | Zod 4 top-level `z.email()`, `z.uuid()` | Zod 4 | Slightly different API but methods still work |
| commander ^12 | commander ^14 | 2025-2026 | No breaking API changes for our usage |
| chalk 4 (CJS) | chalk 5 (ESM-only) | 2022 | Must use ESM; already aligned with project config |
| Manual TypeScript interface + validator | Zod schema as single source of truth | Industry standard by 2024 | Eliminates type/validation drift |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.0 |
| Config file | none -- Wave 0 must create vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLI-05 | `anvil run "test"` prints config summary and exits cleanly | smoke | `npx tsx src/cli.ts run "test" 2>&1 \| grep -q "Max Workers"` | No -- Wave 0 |
| PLAN-04 | Plan validation rejects malformed JSON, accepts valid plans | unit | `npx vitest run tests/schemas/plan.test.ts -x` | No -- Wave 0 |
| PLAN-06 | Plan saved to `.anvil/roadmap.json` | integration | `npx vitest run tests/core/anvil-dir.test.ts -x` | No -- Wave 0 |
| CLUX-04 | `.anvil/` folder created with expected structure | unit | `npx vitest run tests/core/anvil-dir.test.ts -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- vitest configuration for ESM + TypeScript
- [ ] `tests/schemas/plan.test.ts` -- validates PlanSchema accepts/rejects correctly (covers PLAN-04)
- [ ] `tests/schemas/reports.test.ts` -- validates SubJudgeReport, HighCourtReport, CostReport schemas
- [ ] `tests/core/anvil-dir.test.ts` -- validates .anvil/ directory initialization (covers CLUX-04, PLAN-06)
- [ ] `tests/core/validator.test.ts` -- validates plan validation logic (covers PLAN-04)

## Open Questions

1. **Pino version: 9.x or 10.x?**
   - What we know: STACK.md recommends ^9.6.0. npm shows 10.3.1 as latest.
   - What's unclear: Whether 10.x has breaking changes that affect our usage.
   - Recommendation: Use ^9.6.0 per STACK.md. Pino 10 can be evaluated later. Either works for Phase 1's basic file logging.

2. **Project name detection for CLI-05**
   - What we know: Config summary must show "project name".
   - What's unclear: Should it read from the target project's package.json `name` field, or from `.anvilrc`, or use `path.basename(cwd())`?
   - Recommendation: Use `path.basename(process.cwd())` as default, allow override via `.anvilrc` or CLI flag. Keep it simple for Phase 1.

3. **Schema completeness vs Phase 1 scope**
   - What we know: Success criteria say "all core Zod schemas exist and validate sample data."
   - What's unclear: Should schemas include fields that won't be populated until Phase 2+ (e.g., Worker handoffs)?
   - Recommendation: Define complete schema shapes now (matching ARCHITECTURE.md data structures) with optional fields for future data. This prevents breaking changes when Phase 2 adds data to existing types.

## Sources

### Primary (HIGH confidence)
- [Zod v4 docs](https://zod.dev/v4) -- API changes, z.toJSONSchema(), import paths
- [Commander.js README](https://github.com/tj/commander.js) -- subcommand patterns, ESM usage
- npm registry -- verified all package versions 2026-03-21

### Secondary (MEDIUM confidence)
- .planning/research/STACK.md -- stack decisions (verified against npm)
- .planning/research/ARCHITECTURE.md -- file layout, component boundaries, schema structures

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified on npm, versions confirmed
- Architecture: HIGH -- greenfield project, patterns are well-established, documented in ARCHITECTURE.md
- Pitfalls: HIGH -- ESM gotchas and Zod 4 migration are well-documented
- Schemas: MEDIUM -- exact field shapes may evolve as later phases reveal needs

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable libraries, slow-moving domain)
