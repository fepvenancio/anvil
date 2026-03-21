---
phase: 2
slug: planner-and-sequential-execution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.0 |
| **Config file** | vitest.config.ts (from Phase 1) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | PLAN-01, PLAN-02 | unit (mocked LLM) | `npx vitest run tests/unit/planner.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | PLAN-03 | unit | `npx vitest run tests/unit/overlap-detection.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 1 | PLAN-05 | unit | `npx vitest run tests/unit/plan-review.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | EXEC-01, EXEC-03 | integration | `npx vitest run tests/integration/worktree.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | EXEC-02 | unit | `npx vitest run tests/unit/touch-map.test.ts -x` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 3 | CLI-01 | integration | `npx vitest run tests/integration/cli-run.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/planner.test.ts` — mock Anthropic client, verify plan output shape (PLAN-01, PLAN-02)
- [ ] `tests/unit/overlap-detection.test.ts` — overlapping writes detected and rejected (PLAN-03)
- [ ] `tests/unit/plan-review.test.ts` — Y/n/edit prompt behavior with mock stdin (PLAN-05)
- [ ] `tests/unit/touch-map.test.ts` — enforce declared files only (EXEC-02)
- [ ] `tests/unit/topological-sort.test.ts` — dependency ordering correctness
- [ ] `tests/integration/worktree.test.ts` — real git in temp dir, worktree create/commit/merge/cleanup (EXEC-01, EXEC-03)
- [ ] `tests/integration/cli-run.test.ts` — full pipeline with mocked LLM (CLI-01)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| $EDITOR opens plan JSON on 'edit' | PLAN-05 | Requires interactive terminal + editor | Run `anvil run "test"`, choose 'edit', verify editor opens with valid JSON |
| Plan review UX flow feels natural | PLAN-05 | Subjective UX quality | Run full flow, verify prompt timing and output clarity |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
