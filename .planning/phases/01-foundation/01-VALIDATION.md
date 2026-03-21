---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.0 |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | CLI-05 | smoke | `npx tsx src/cli.ts run "test" 2>&1 \| grep -q "Max Workers"` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | PLAN-04 | unit | `npx vitest run tests/schemas/plan.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | PLAN-06 | integration | `npx vitest run tests/core/anvil-dir.test.ts -x` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | CLUX-04 | unit | `npx vitest run tests/core/anvil-dir.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — vitest configuration for ESM + TypeScript
- [ ] `tests/schemas/plan.test.ts` — validates PlanSchema accepts/rejects correctly (covers PLAN-04)
- [ ] `tests/schemas/reports.test.ts` — validates SubJudgeReport, HighCourtReport, CostReport schemas
- [ ] `tests/core/anvil-dir.test.ts` — validates .anvil/ directory initialization (covers CLUX-04, PLAN-06)
- [ ] `tests/core/validator.test.ts` — validates plan validation logic (covers PLAN-04)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CLI prints ASCII logo + styled output | CLI-05 | Visual formatting requires human check | Run `npx tsx src/cli.ts run "test"`, verify styled output displays correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
