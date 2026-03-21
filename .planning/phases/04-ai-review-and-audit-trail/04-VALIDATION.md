---
phase: 4
slug: ai-review-and-audit-trail
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.0 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~12 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | COST-01, COST-02 | unit | `npx vitest run tests/unit/cost-tracker.test.ts -x` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | COST-03, COST-04 | unit+int | `npx vitest run tests/unit/cost-display.test.ts tests/integration/cost-report.test.ts -x` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | REVW-03, REVW-04, REVW-05 | unit | `npx vitest run tests/unit/high-court.test.ts -x` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | EXEC-09 | integration | `npx vitest run tests/integration/rollback.test.ts -x` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 2 | LIBR-01, LIBR-02, LIBR-03 | unit+int | `npx vitest run tests/unit/librarian.test.ts tests/integration/librarian-commit.test.ts -x` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04 | 3 | All 11 | integration | `npx vitest run -x && npx tsc --noEmit` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/cost-tracker.test.ts` — CostTracker record/getWaveCost/getSessionCost (COST-01, COST-02)
- [ ] `tests/unit/cost-display.test.ts` — formatCostSummary output (COST-03)
- [ ] `tests/integration/cost-report.test.ts` — saveCostReport writes .anvil/cost-report.json (COST-04)
- [ ] `tests/unit/high-court.test.ts` — structured output mock, merge/human_required/abort verdicts (REVW-03, REVW-04, REVW-05)
- [ ] `tests/integration/rollback.test.ts` — git reset --hard on abort, branch cleanup (EXEC-09)
- [ ] `tests/unit/librarian.test.ts` — README.md and ARCHITECTURE.md generation (LIBR-01, LIBR-02)
- [ ] `tests/integration/librarian-commit.test.ts` — docs committed atomically (LIBR-03)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| High Court review quality with real API | REVW-05 | AI output quality requires human judgment | Run full build with API key, review High Court report for meaningful architectural feedback |
| Librarian doc quality | LIBR-01, LIBR-02 | Generated doc relevance requires human review | Check generated README and ARCHITECTURE for accuracy |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
