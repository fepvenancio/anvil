# Anvil v2 Quality Plan — From "AI Slop" to Production-Grade

## Current State (v0.1.12)

**What works:**
- Pipeline: Planner → Workers → Sub-Judges → High Court → Librarian → Cost ✓
- Workers use Claude Code Agent SDK (can read files, run tests, iterate) ✓
- Parallel wave execution with topological sort ✓
- Sub-Judges catch real issues (tsc failures, touch-map violations) ✓
- Auth inherited from parent CLI (Claude Code) ✓
- Published on npm as `anvil-ai` ✓

**What fails:**
- Wave 3 consistently fails on tsc — workers generate code that doesn't compile against earlier waves
- Workers guess import paths, function signatures, type names instead of reading actual code
- No default tech stack — Planner has to guess everything from a one-line spec
- No scaffold step — workers create tsconfig/package.json inconsistently
- Touch-map was blocking on node_modules (fixed) but Sub-Judge still fragile
- 174 tests pass but real-world builds fail at Wave 3

**Benchmark results (3 attempts, CLI calculator):**
- v0.1.4: Wave 1 halted — touch-map blocked on node_modules
- v0.1.8: Wave 1 halted — no API key (auth not inherited)
- v0.1.12: Wave 1+2 passed, Wave 3 halted — tsc failure (workers generated incompatible code)

## Research Findings (Hard Data)

### The Industry Problem
| Metric | Data | Source |
|--------|------|--------|
| AI code has 2.74x more vulnerabilities | Tested 100+ LLMs across 4 languages | Veracode 2025 |
| 1.7x more bugs in AI PRs | 470 open-source GitHub PRs analyzed | CodeRabbit |
| Code duplication 4x increase | 211 million lines analyzed | GitClear 2025 |
| AI makes experienced devs 19% slower | 16 devs, controlled study | METR 2025 |
| 45% of AI code has security vulnerabilities | Multi-language, multi-model study | Veracode |
| 37.6% more vulns after 5 AI fix iterations | Iterative degradation paradox | IEEE ISTAS 2025 |
| 30% higher change failure rate | AI-assisted vs human development | CodeRabbit |

### Root Causes (Mapped to Anvil)
1. **Planner-Coder Gap (75% of multi-agent failures)** — Plan says "import X from Y" but Worker generates different exports. THIS IS OUR WAVE 3 FAILURE.
2. **Happy-path only** — Workers handle the expected case, miss edge cases
3. **No architectural coherence** — Each task generates fine code, but together it's spaghetti
4. **API hallucination** — Workers use methods/params that don't exist in the library version installed
5. **No refactoring** — Copy-paste patterns instead of shared abstractions
6. **Generic error handling** — catch-all instead of specific recovery

### What Works (Proven Mitigations)
1. **Opinionated frameworks** — Rails, Next.js produce better AI code because there's "usually one correct approach"
2. **TypeScript strict mode** — Type system constrains AI output, catches errors at compile time
3. **CI-enforced linters/formatters** — "Eliminates entire categories of AI-driven issues before review"
4. **Narrowly scoped, role-specific agents** — Better than one general agent
5. **Repo-specific instruction files** — Encoding architectural constraints in prompts

## The Plan

### Phase 1: Default Stack + Smart Scaffold (HIGH IMPACT, LOW EFFORT)

**Problem:** Planner gets "Build a calculator" and has to guess EVERYTHING.

**Fix:** Bake a default TypeScript stack into the Planner's system prompt + always scaffold first.

**Changes:**
1. **Update `src/prompts/planner-system.ts`** — Add default stack section:
   ```
   DEFAULT STACK (use unless user specifies otherwise):
   - TypeScript 5.x, strict mode, ESM ("type": "module")
   - Node 22+
   - Vitest for testing
   - Zod for validation
   - tsconfig.json: strict, ES2022, node16 module resolution
   ```

2. **Planner MUST generate a scaffold task as task-001:**
   - Creates: package.json, tsconfig.json, .gitignore, src/ directory
   - This task has NO dependencies and runs first
   - All other tasks depend on it
   - Exact content specified in the plan (not left to the Worker)

3. **Planner MUST declare interface contracts:**
   - For each file in writes[], specify the exact exports (function names, types)
   - Downstream tasks reference these contracts, not assumptions
   - Example: task-002 writes calculator.ts exporting `calculate(op, a, b): number`
   - task-003 writes tests importing `calculate` — matches exactly

**Files to modify:**
- `src/prompts/planner-system.ts` — Add default stack + scaffold rules + interface contracts
- `src/schemas/plan.ts` — Add optional `exports` field to Task schema (interface contract)

### Phase 2: Workers Read Before Writing (HIGH IMPACT, MEDIUM EFFORT)

**Problem:** Wave 3 workers generate code that doesn't compile because they don't read the actual output from Wave 1+2.

**Fix:** Worker prompt must include the ACTUAL code from earlier waves, not just task descriptions.

**Changes:**
1. **Update `src/workers/worker.ts`** — Before executing, read ALL files in `task.reads[]` from the worktree and inject their contents into the prompt:
   ```
   ### Context: src/calculator.ts (from earlier wave)
   [actual file contents]

   Your code MUST be compatible with these imports/exports.
   ```

2. **Update `src/prompts/worker-system.ts`** — Add rules:
   ```
   MANDATORY RULES:
   - Read ALL context files before writing ANY code
   - Your imports MUST match the EXACT export names in context files
   - Run `npx tsc --noEmit` after writing and fix any errors
   - Run tests if they exist and fix failures
   - Do NOT assume function names — READ the actual files
   ```

**Files to modify:**
- `src/workers/worker.ts` — Read context files, inject into prompt
- `src/prompts/worker-system.ts` — Add compatibility rules

### Phase 3: tsc as Worker Tool, Not Just Judge (MEDIUM IMPACT)

**Problem:** Workers declare success without checking if code compiles. Sub-Judge catches it too late.

**Fix:** Worker prompt tells Claude Code to run tsc and fix errors before finishing.

**Changes:**
1. **Update `src/prompts/worker-system.ts`** — Add verification step:
   ```
   BEFORE declaring task complete:
   1. Run `npx tsc --noEmit` — fix ALL errors
   2. Run `npx vitest run` (if test files exist) — fix ALL failures
   3. Only then report success
   ```

This is mostly a prompt change — the Claude Code Agent SDK already gives workers Bash access to run tsc/vitest. We just need to TELL them to do it.

**Files to modify:**
- `src/prompts/worker-system.ts` — Add self-verification rules

### Phase 4: Security Baseline (MEDIUM IMPACT, LOW EFFORT)

**Problem:** AI generates 2.74x more vulnerabilities. Anvil has no security checks.

**Fix:** Add a security Sub-Judge (basic static analysis).

**Changes:**
1. **Create `src/judges/security-judge.ts`** — Check for common patterns:
   - No `eval()` or `new Function()`
   - No hardcoded API keys/passwords (regex scan)
   - No SQL string concatenation (if SQL files exist)
   - No `innerHTML` assignment (if HTML/JSX files exist)
   - No `http://` URLs (should be https)

2. **Update `src/judges/sub-judge-panel.ts`** — Add security judge to the panel

**Files to create:**
- `src/judges/security-judge.ts`

**Files to modify:**
- `src/judges/sub-judge-panel.ts`

### Phase 5: Configurable Stack Presets (LOW IMPACT, NICE-TO-HAVE)

**Problem:** Some users want Python, Go, etc.

**Fix:** Stack presets that change the Planner prompt.

```bash
anvil run "Build X"                    # Default: TypeScript
anvil run "Build X" --stack python     # Python + FastAPI + pytest
anvil run "Build X" --stack go         # Go + Chi + stdlib testing
```

**Changes:**
1. **Create `src/stacks/` directory** with preset configs
2. **Update CLI** — Add `--stack` flag
3. **Update Planner prompt** — Inject stack-specific instructions

### Phase 6: Quick Context Mode (MEDIUM IMPACT)

**Problem:** Complex apps need more context than a one-line spec.

**Fix:** Optional interactive questionnaire OR spec file.

```bash
anvil run "Build a todo API" --interactive  # Ask questions first
anvil run --spec todo-api.md                # Read detailed spec from file
```

**Changes:**
1. **Create `src/ui/questionnaire.ts`** — Quick 3-5 questions (stack, auth, database, etc.)
2. **Update CLI** — Add `--interactive` and `--spec` flags
3. **Update Planner** — Include answers in prompt context

## Priority Order

| Priority | Phase | Impact | Effort | Why First |
|----------|-------|--------|--------|-----------|
| 1 | Phase 1: Default Stack + Scaffold | HIGH | LOW | Fixes the root cause of tsc failures |
| 2 | Phase 2+3: Workers Read + Self-Verify | HIGH | MEDIUM | Fixes Wave 3 incompatibility |
| 3 | Phase 4: Security Judge | MEDIUM | LOW | Addresses 2.74x vulnerability gap |
| 4 | Phase 5: Stack Presets | LOW | LOW | Nice-to-have for non-TS users |
| 5 | Phase 6: Context Mode | MEDIUM | MEDIUM | Needed for complex apps |

## Success Criteria

After these changes, the CLI calculator benchmark should:
- [x] Wave 1: scaffold + types pass all judges
- [x] Wave 2: implementation passes all judges
- [x] Wave 3: tests pass (imports match actual exports)
- [x] Wave 4: High Court approves
- [x] Wave 5: Librarian generates docs
- [ ] Total cost < $0.50
- [ ] Total time < 3 minutes
- [ ] Zero tsc errors
- [ ] Zero test failures
- [ ] No security vulnerabilities in generated code

## Files Summary

**Modify:**
- `src/prompts/planner-system.ts` — Default stack, scaffold rules, interface contracts
- `src/prompts/worker-system.ts` — Read-first rules, self-verification
- `src/workers/worker.ts` — Inject context file contents into prompt
- `src/schemas/plan.ts` — Optional exports field on Task
- `src/judges/sub-judge-panel.ts` — Add security judge

**Create:**
- `src/judges/security-judge.ts` — Basic security static analysis

**No changes needed:**
- `src/cli.ts` — Pipeline already correct
- `src/orchestrator/wave-runner.ts` — Wave execution already correct
- `src/git/worktree-manager.ts` — Worktree management already correct
- `src/judges/tsc-judge.ts` — Already works
- `src/judges/vitest-judge.ts` — Already works
- `src/judges/touch-map-judge.ts` — Already fixed
