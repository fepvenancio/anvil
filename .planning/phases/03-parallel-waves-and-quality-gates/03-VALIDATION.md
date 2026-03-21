---
phase: 3
slug: parallel-waves-and-quality-gates
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.0 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run && npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 12 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | EXEC-04 | unit | `npx vitest run tests/unit/topological-waves.test.ts -x` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | EXEC-05, EXEC-06, EXEC-07 | integration | `npx vitest run tests/integration/wave-runner.test.ts -x` | ❌ W0 | ⬜ pending |
| 03-01-03 | 01 | 1 | EXEC-08 | unit | `npx vitest run tests/unit/wave-error-handling.test.ts -x` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | REVW-01, REVW-01a | unit | `npx vitest run tests/unit/sub-judge-panel.test.ts -x` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | REVW-02 | integration | `npx vitest run tests/integration/wave-runner.test.ts -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/topological-waves.test.ts` — wave grouping from DAG (EXEC-04)
- [ ] `tests/unit/sub-judge-panel.test.ts` — judge orchestration + individual judges (REVW-01, REVW-01a)
- [ ] `tests/unit/wave-error-handling.test.ts` — failed tasks don't crash wave (EXEC-08)
- [ ] `tests/integration/wave-runner.test.ts` — full wave lifecycle with real git (EXEC-05, EXEC-06, EXEC-07, REVW-02)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Parallel execution visibly faster than sequential | EXEC-05 | Timing is environment-dependent | Run with 4+ independent tasks, compare wall time to sequential |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 12s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
