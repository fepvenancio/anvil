# Phase 4: AI Review and Audit Trail - Research

**Researched:** 2026-03-21
**Domain:** AI architectural review, documentation generation, token cost tracking
**Confidence:** HIGH

## Summary

Phase 4 adds three distinct capabilities to Anvil: (1) High Court AI architectural review after all waves complete, (2) Librarian document generation after High Court approval, and (3) cost tracking woven through every Anthropic API call. The codebase is well-prepared -- schemas for `HighCourtReport`, `CostReport`, and `CostEntry` already exist in `src/schemas/reports.ts`, and the Sub-Judge panel in `src/judges/sub-judge-panel.ts` provides the exact pattern to follow for High Court implementation (single function, structured output, Zod validation).

The main integration point is `src/orchestrator/wave-runner.ts`, which currently returns `WaveExecutionResult` after all waves succeed. This needs to be extended (or wrapped at the CLI level in `src/cli.ts`) with a post-wave High Court step, rollback on abort, Librarian generation on approval, and cost accumulation throughout. The Anthropic SDK response object provides `usage.input_tokens`, `usage.output_tokens`, `usage.cache_creation_input_tokens`, and `usage.cache_read_input_tokens` on every `messages.create()` and `messages.parse()` call -- these are the hooks for cost tracking.

The rollback requirement (EXEC-09) is the most architecturally sensitive piece: on High Court abort or human_required, the last wave's merge must be undone via `git reset --hard` to a pre-build baseline SHA. This requires capturing the baseline SHA before execution begins and performing cleanup after reset.

**Primary recommendation:** Build cost tracking infrastructure first (it integrates everywhere), then High Court (it gates the Librarian), then Librarian (it depends on High Court approval), then wire rollback into the pipeline.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REVW-03 | High Court performs a single end-of-build AI architectural review | Use Anthropic SDK structured output with `HighCourtReportSchema` (already defined). Follow Sub-Judge panel pattern but with AI call instead of mechanical check. |
| REVW-04 | High Court produces merge/human_required/abort decisions with report saved to `.anvil/high-court-report.json` | Schema already has `verdict`, `reasoning`, `concerns`, `invariantChecks` fields. Use `zodOutputFormat` for structured output parsing. |
| REVW-05 | High Court checks architectural invariants, circular deps, cross-task coherence | Build invariant checks into the High Court system prompt. Feed it Sub-Judge reports, plan spec, and git diff summary. |
| EXEC-09 | If High Court aborts or escalates, rollback last wave merge via git reset --hard + worktree cleanup | Capture baseline SHA before `executeInWaves()`. On abort/human_required, `git reset --hard <baselineSha>` + `worktreeManager.cleanupAll()`. |
| LIBR-01 | Librarian auto-generates README.md from build artifacts after High Court approval | Single Anthropic API call with project files + High Court notes as context. Write output to project root. |
| LIBR-02 | Librarian auto-generates ARCHITECTURE.md from project structure and High Court notes | Same pattern as LIBR-01. Feed directory tree + High Court invariant analysis. |
| LIBR-03 | Generated docs committed as atomic commits | Use `simple-git` to `add` + `commit` each doc file separately (or both together as one atomic commit). |
| COST-01 | Token usage (input/output/cache) tracked per agent call | Wrap Anthropic client or extract `response.usage` after every `messages.create()`/`messages.parse()` call. Accumulate into `CostEntry[]`. |
| COST-02 | Cost calculated per wave and per session using model pricing | Pricing lookup table keyed by model name. Multiply tokens by per-MTok rates. Accumulate per-wave and session totals. |
| COST-03 | Cost summary displayed at build completion | Print formatted table to stdout after pipeline completes. |
| COST-04 | Cost report saved to `.anvil/cost-report.json` | Serialize `CostReport` (schema exists) to JSON file. |
</phase_requirements>

## Standard Stack

### Core (already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/sdk | ^0.80.0 | High Court + Librarian API calls | Already used for Planner and Worker. `response.usage` provides token tracking. |
| simple-git | ^3.33.0 | Rollback (`git reset --hard`), doc commits | Already used for worktree management and merges. |
| zod | ^4.3.6 | Validate High Court and Cost Report outputs | Already used for all schema validation. |
| chalk | ^5.6.2 | Cost summary display formatting | Already used throughout CLI output. |

### No New Dependencies Required

This phase requires zero new dependencies. All capabilities are built on the existing Anthropic SDK, simple-git, Zod, and chalk.

## Architecture Patterns

### Recommended Project Structure (new files)

```
src/
  judges/
    high-court.ts          # High Court AI review (new)
  stations/
    librarian.ts           # Librarian doc generator (new)
  cost/
    tracker.ts             # CostTracker class — accumulates token usage (new)
    pricing.ts             # Model pricing lookup table (new)
  orchestrator/
    wave-runner.ts         # Extended: returns baseline SHA, accepts cost tracker
  cli.ts                   # Extended: post-wave pipeline (High Court -> rollback/Librarian -> cost display)
  prompts/
    high-court-system.ts   # High Court system prompt (new)
    librarian-system.ts    # Librarian system prompt (new)
```

### Pattern 1: Cost Tracker (Accumulator Pattern)

**What:** A singleton-style `CostTracker` class that collects `response.usage` from every Anthropic API call and computes running cost totals.
**When to use:** Injected into every component that makes API calls (Planner, Worker, High Court, Librarian).
**Why:** Cost tracking must be woven through the entire pipeline. A centralized accumulator avoids scattered cost logic.

```typescript
// Source: Anthropic SDK response.usage structure (verified from official docs)
interface TokenUsage {
  agent: string;           // 'planner' | 'worker:task-001' | 'high-court' | 'librarian'
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  model: string;
  waveNumber?: number;     // undefined for planner, high-court, librarian
}

class CostTracker {
  private entries: TokenUsage[] = [];

  record(usage: TokenUsage): void {
    this.entries.push(usage);
  }

  // Extract usage from Anthropic SDK response
  recordFromResponse(
    response: { usage: Anthropic.Usage },
    agent: string,
    model: string,
    waveNumber?: number,
  ): void {
    this.record({
      agent,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      model,
      waveNumber,
    });
  }

  toCostReport(sessionId: string): CostReport {
    const entries = this.entries.map(e => ({
      agent: e.agent,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      cacheReadTokens: e.cacheReadTokens,
      cacheWriteTokens: e.cacheWriteTokens,
      costUsd: calculateCost(e),
    }));
    return {
      sessionId,
      entries,
      totalCostUsd: entries.reduce((sum, e) => sum + e.costUsd, 0),
      timestamp: new Date().toISOString(),
    };
  }
}
```

### Pattern 2: High Court as Post-Build Gate

**What:** High Court runs once after all waves complete successfully. It reads the git diff from baseline to HEAD, Sub-Judge reports, the original plan spec, and produces a structured verdict.
**When to use:** After `executeInWaves()` returns `success: true`.
**Why:** Full-project review is more valuable than per-wave. Matches Forge's design: handoff-first review.

```typescript
// High Court follows the same pattern as Sub-Judge panel:
// single exported function, Zod-validated output, structured Anthropic call
async function runHighCourt(
  projectDir: string,
  plan: Plan,
  judgeReports: SubJudgeReport[],
  config: AnvilConfig,
  options?: { client?: Anthropic; costTracker?: CostTracker },
): Promise<HighCourtReport> {
  // 1. Gather context: git diff --stat, file tree, Sub-Judge summaries
  // 2. Build prompt with HIGH_COURT_SYSTEM_PROMPT
  // 3. Call client.messages.parse() with zodOutputFormat(HighCourtReportSchema)
  // 4. Record usage to costTracker
  // 5. Return validated HighCourtReport
}
```

### Pattern 3: Pipeline Orchestration (Post-Wave Steps in CLI)

**What:** The CLI (`src/cli.ts`) orchestrates the post-wave pipeline: waves -> High Court -> rollback/Librarian -> cost summary. This keeps `wave-runner.ts` focused on wave execution.
**When to use:** In the `run` command action handler.
**Why:** Separation of concerns. Wave runner handles waves + Sub-Judges. CLI handles the build lifecycle.

```typescript
// In cli.ts run action:
const baselineSha = await git.revparse(['HEAD']);
const costTracker = new CostTracker();

// Execute waves (pass costTracker for worker token recording)
const result = await executeInWaves(plan, config, { baseDir, costTracker });

if (result.success) {
  // High Court review
  const verdict = await runHighCourt(baseDir, plan, result.judgeReports, config, { costTracker });
  await writeFile(join(anvilDir, 'high-court-report.json'), JSON.stringify(verdict, null, 2));

  if (verdict.verdict === 'abort' || verdict.verdict === 'human_required') {
    // EXEC-09: Rollback
    await git.reset(['--hard', baselineSha]);
    // Display concerns...
  } else {
    // Librarian generates docs
    await runLibrarian(baseDir, plan, verdict, config, { costTracker });
  }
}

// Always: display and save cost report
const costReport = costTracker.toCostReport(sessionId);
await writeFile(join(anvilDir, 'cost-report.json'), JSON.stringify(costReport, null, 2));
displayCostSummary(costReport);
```

### Pattern 4: Rollback via Git Reset

**What:** On High Court abort/human_required, reset main to the pre-build baseline SHA.
**When to use:** After High Court produces an `abort` or `human_required` verdict.
**Why:** Prevents bad architecture from leaking into main. Clean rollback.

```typescript
// Capture BEFORE execution starts:
const baselineSha = await git.revparse(['HEAD']);

// On abort/human_required:
await git.reset(['--hard', baselineSha]);
// All wave merges are undone. Clean state restored.
```

**Important:** The baseline SHA must be captured before `executeInWaves()` starts, not during. The wave runner merges branches into main progressively, so HEAD moves during execution.

### Pattern 5: Librarian as Single-Shot Document Generator

**What:** Librarian reads the final codebase (file tree + key files) and generates README.md and ARCHITECTURE.md in one or two API calls.
**When to use:** Only after High Court returns `merge` verdict.
**Why:** Docs should describe the final, approved codebase. Generating before review wastes tokens if review fails.

### Anti-Patterns to Avoid

- **Running High Court per-wave:** Expensive and provides partial view. Run once at end. (Forge design decision)
- **High Court reading all source files:** Feed it git diff + file tree + Sub-Judge summaries first. Only specific files if needed. (Handoff-first principle)
- **Cost tracking as post-hoc log parsing:** Cost must be tracked in-band as API calls happen, not reconstructed from logs.
- **Librarian before High Court approval:** Wastes tokens if build gets aborted.
- **Hardcoding model pricing:** Use a lookup table keyed by model string so pricing updates are one-line changes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token usage extraction | Manual JSON parsing of response | `response.usage.input_tokens` etc. from SDK | SDK provides typed usage object on every response |
| Structured High Court output | Free-text parsing of verdict | `zodOutputFormat(HighCourtReportSchema)` with `messages.parse()` | Same pattern already used by Planner |
| Git rollback | Manual branch manipulation | `git.reset(['--hard', baselineSha])` via simple-git | One operation, deterministic, well-tested |
| Cost calculation | Per-call HTTP to pricing API | Static pricing lookup table in code | Pricing changes rarely, static is simpler and offline |

## Common Pitfalls

### Pitfall 1: Cost Tracker Not Wired to Worker Calls

**What goes wrong:** Worker (`executeTask`) makes API calls but doesn't record usage because the `CostTracker` wasn't passed through the call chain.
**Why it happens:** Worker currently doesn't return usage data. The `WorkerResult` interface has no `usage` field.
**How to avoid:** Either (a) extend `WorkerResult` to include `usage` data, or (b) wrap the Anthropic client with a proxy that automatically records usage to the tracker.
**Warning signs:** Cost report shows $0 for worker calls.

### Pitfall 2: Baseline SHA Captured Too Late

**What goes wrong:** Baseline SHA is captured after some waves already merged, so rollback only partially undoes the build.
**Why it happens:** Developer puts SHA capture inside the wave loop or after the first wave.
**How to avoid:** Capture `baselineSha = await git.revparse(['HEAD'])` BEFORE calling `executeInWaves()`.
**Warning signs:** After rollback, some build artifacts remain in the repository.

### Pitfall 3: High Court Hallucinates Invariant Checks

**What goes wrong:** High Court claims it checked for circular dependencies but actually just pattern-matched on the prompt. It reports "no circular dependencies found" without actually analyzing the import graph.
**Why it happens:** LLMs are prone to confident but unverified claims, especially for mechanical checks.
**How to avoid:** Do NOT rely on High Court for mechanical checks (that is the Sub-Judges' job). High Court checks architectural coherence and design quality -- subjective judgment that LLMs are good at. Structure the prompt to focus on design review, not code linting.
**Warning signs:** High Court invariant checks always pass regardless of code quality.

### Pitfall 4: Rollback Leaves Orphaned Branches

**What goes wrong:** `git reset --hard` moves HEAD but doesn't clean up the task branches created during execution. Subsequent runs may encounter "branch already exists" errors.
**Why it happens:** `git reset` only moves the branch pointer; it doesn't delete other branches.
**How to avoid:** After rollback, run `git branch -D` for all task branches from the aborted run. The `WorktreeManager.cleanupAll()` already handles this for active worktrees, but verify branches are cleaned even after worktree removal.
**Warning signs:** `git branch -a` shows dozens of `anvil/run-*/task-*` branches.

### Pitfall 5: Librarian Context Window Overflow

**What goes wrong:** For large projects, feeding all source files to the Librarian exceeds the context window.
**Why it happens:** Projects with many files generate large prompts.
**How to avoid:** Feed the Librarian a curated summary: directory tree, package.json, key entry points, and the High Court report (which already summarizes architecture). Don't feed raw source code -- feed structure and descriptions.
**Warning signs:** Librarian API call fails with context length error.

## Code Examples

### Anthropic SDK Usage Extraction

```typescript
// Source: Anthropic SDK TypeScript — response.usage object
// Every messages.create() and messages.parse() response includes usage:
const response = await client.messages.create({
  model: config.model,
  max_tokens: 4096,
  system: HIGH_COURT_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: reviewPrompt }],
});

// response.usage is always present:
const usage = response.usage;
// usage.input_tokens: number (always present)
// usage.output_tokens: number (always present)
// usage.cache_creation_input_tokens: number (0 if no caching)
// usage.cache_read_input_tokens: number (0 if no caching)
```

### Model Pricing Table

```typescript
// Source: https://platform.claude.com/docs/en/about-claude/pricing (verified 2026-03-21)
// Prices per million tokens (MTok)
interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;   // 5-min cache write (1.25x input)
  cacheReadPerMTok: number;    // cache hit (0.1x input)
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-sonnet-4-20250514': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheWritePerMTok: 3.75,
    cacheReadPerMTok: 0.30,
  },
  'claude-haiku-4-5-20250514': {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.10,
  },
  // Add more models as needed
};

function calculateCost(usage: TokenUsage): number {
  const pricing = MODEL_PRICING[usage.model];
  if (!pricing) {
    // Fallback: use Sonnet pricing as default
    return calculateCostWithPricing(usage, MODEL_PRICING['claude-sonnet-4-20250514']);
  }
  return calculateCostWithPricing(usage, pricing);
}

function calculateCostWithPricing(usage: TokenUsage, pricing: ModelPricing): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTok +
    (usage.cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMTok +
    (usage.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMTok
  );
}
```

### High Court Structured Output (following Planner pattern)

```typescript
// Source: existing pattern from src/stations/planner.ts
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { HighCourtReportSchema, type HighCourtReport } from '../schemas/reports.js';

const response = await (client.messages as any).parse({
  model: config.model,
  max_tokens: 4096,
  system: HIGH_COURT_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: reviewContext }],
  output_config: { format: zodOutputFormat(HighCourtReportSchema) },
});

const report: HighCourtReport | null | undefined = response.parsed_output;
```

### Git Rollback

```typescript
// Source: simple-git API
import { simpleGit } from 'simple-git';

// Before build:
const git = simpleGit(baseDir);
const baselineSha = await git.revparse(['HEAD']);

// After High Court abort:
await git.reset(['--hard', baselineSha]);
// Verify:
const currentSha = await git.revparse(['HEAD']);
assert(currentSha === baselineSha, 'Rollback failed');
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Anthropic SDK beta header for structured output | `output_config.format` with `zodOutputFormat` — no beta header needed | SDK v0.80.0 | High Court uses same pattern as Planner |
| Manual token counting | SDK provides `response.usage` on every call | Always available | No custom counting needed |
| Cache tokens as single field | Split into `cache_creation_input_tokens` and `cache_read_input_tokens` | SDK v0.50+ | Track write vs read cache costs separately |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.0 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REVW-03 | High Court produces structured review from plan + judge reports | unit | `npx vitest run tests/unit/high-court.test.ts -x` | No -- Wave 0 |
| REVW-04 | High Court verdict is merge/human_required/abort, report saved to JSON | unit | `npx vitest run tests/unit/high-court.test.ts -x` | No -- Wave 0 |
| REVW-05 | High Court checks invariants (prompt covers arch, deps, coherence) | unit | `npx vitest run tests/unit/high-court.test.ts -x` | No -- Wave 0 |
| EXEC-09 | Rollback on abort: git reset --hard to baseline SHA | integration | `npx vitest run tests/integration/rollback.test.ts -x` | No -- Wave 0 |
| LIBR-01 | Librarian generates README.md | unit | `npx vitest run tests/unit/librarian.test.ts -x` | No -- Wave 0 |
| LIBR-02 | Librarian generates ARCHITECTURE.md | unit | `npx vitest run tests/unit/librarian.test.ts -x` | No -- Wave 0 |
| LIBR-03 | Generated docs committed as atomic commits | integration | `npx vitest run tests/integration/librarian-commit.test.ts -x` | No -- Wave 0 |
| COST-01 | Token usage tracked per agent call | unit | `npx vitest run tests/unit/cost-tracker.test.ts -x` | No -- Wave 0 |
| COST-02 | Cost calculated per wave and per session | unit | `npx vitest run tests/unit/cost-tracker.test.ts -x` | No -- Wave 0 |
| COST-03 | Cost summary displayed at build completion | unit | `npx vitest run tests/unit/cost-display.test.ts -x` | No -- Wave 0 |
| COST-04 | Cost report saved to `.anvil/cost-report.json` | integration | `npx vitest run tests/integration/cost-report.test.ts -x` | No -- Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run && npx tsc --noEmit`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps

- [ ] `tests/unit/cost-tracker.test.ts` -- covers COST-01, COST-02
- [ ] `tests/unit/high-court.test.ts` -- covers REVW-03, REVW-04, REVW-05
- [ ] `tests/unit/librarian.test.ts` -- covers LIBR-01, LIBR-02
- [ ] `tests/integration/rollback.test.ts` -- covers EXEC-09
- [ ] `tests/integration/librarian-commit.test.ts` -- covers LIBR-03
- [ ] `tests/unit/cost-display.test.ts` -- covers COST-03
- [ ] `tests/integration/cost-report.test.ts` -- covers COST-04

## Open Questions

1. **How much context should High Court receive?**
   - What we know: Forge uses handoff-first (summaries before code). Anvil v1 has no Worker handoff documents (deferred to v2 per ARVW-01).
   - What's unclear: Without handoffs, what should High Court read? Options: (a) git diff --stat + plan spec + Sub-Judge reports, (b) full git diff, (c) directory tree + key file contents.
   - Recommendation: Use `git diff --stat` (file-level summary), `git diff` (full diff capped at ~50KB), plan spec, and Sub-Judge reports. This gives architectural overview without blowing context window.

2. **Should CostTracker be a class instance or module-level singleton?**
   - What we know: It needs to be accessible from Planner, Workers, High Court, and Librarian.
   - What's unclear: Workers run in parallel -- is a shared mutable accumulator safe?
   - Recommendation: Class instance created in CLI, passed as option to each component. Workers run as async functions in same process (not child processes), so a single CostTracker with `push()` is safe -- no race conditions because each Worker awaits its API call before pushing.

3. **CostEntry schema needs waveNumber field**
   - What we know: Current `CostEntrySchema` has `agent`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `costUsd`.
   - What's unclear: COST-02 requires "cost per wave" -- but there's no `waveNumber` field on `CostEntry`.
   - Recommendation: Add optional `waveNumber` field to `CostEntrySchema`. Planner and High Court entries have no wave; Worker entries have a wave number. Per-wave cost is sum of entries with matching waveNumber.

## Sources

### Primary (HIGH confidence)

- [Anthropic API Pricing](https://platform.claude.com/docs/en/about-claude/pricing) -- verified 2026-03-21, full model pricing table with cache pricing multipliers
- Existing codebase: `src/schemas/reports.ts` -- HighCourtReportSchema, CostReportSchema already defined
- Existing codebase: `src/stations/planner.ts` -- `zodOutputFormat` + `messages.parse()` pattern for structured output
- Existing codebase: `src/judges/sub-judge-panel.ts` -- parallel judge execution pattern
- Existing codebase: `src/orchestrator/wave-runner.ts` -- wave execution loop, integration point
- Existing codebase: `src/workers/worker.ts` -- worker API call pattern, token tracking integration point

### Secondary (MEDIUM confidence)

- [Anthropic SDK TypeScript GitHub](https://github.com/anthropics/anthropic-sdk-typescript) -- `response.usage` structure with cache token fields
- [Anthropic SDK Issue #793](https://github.com/anthropics/anthropic-sdk-typescript/issues/793) -- cache TTL breakdown in usage (ephemeral_5m vs 1h fields)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all patterns already established in codebase
- Architecture: HIGH -- clear integration points, schemas pre-defined, patterns proven in Phases 1-3
- Pitfalls: HIGH -- rollback edge cases and cost tracking wiring are well-understood risks
- Pricing data: HIGH -- verified directly from official Anthropic pricing page on 2026-03-21

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable domain, pricing may change but architecture is solid)
