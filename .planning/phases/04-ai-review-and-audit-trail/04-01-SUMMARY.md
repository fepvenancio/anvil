---
phase: 04-ai-review-and-audit-trail
plan: 01
subsystem: cost-tracking
tags: [token-tracking, cost-calculation, anthropic-sdk, zod]

requires:
  - phase: 01-cli-and-schemas
    provides: CostEntrySchema and CostReportSchema in reports.ts
provides:
  - CostTracker class for accumulating token usage per agent call
  - calculateCost function with model pricing lookup
  - MODEL_PRICING table (sonnet, haiku)
  - CostEntry schema with optional waveNumber field
affects: [04-02-high-court, 04-03-librarian, 04-04-cli-wiring]

tech-stack:
  added: []
  patterns: [token-usage-accumulator, model-pricing-lookup, sdk-response-extraction]

key-files:
  created:
    - src/cost/tracker.ts
    - src/cost/pricing.ts
    - tests/unit/cost-tracker.test.ts
  modified:
    - src/schemas/reports.ts

key-decisions:
  - "Fallback to sonnet pricing for unknown model strings (safe default, highest cost)"
  - "CostTracker stores raw TokenUsage entries and computes cost on demand via calculateCost"

patterns-established:
  - "Cost accumulator pattern: record raw token counts, calculate USD on report generation"
  - "SDK response extraction: recordFromResponse maps Anthropic usage fields to internal TokenUsage"

requirements-completed: [COST-01, COST-02]

duration: 2min
completed: 2026-03-21
---

# Phase 4 Plan 1: Cost Tracking Infrastructure Summary

**CostTracker accumulator with model pricing lookup (sonnet/haiku) and per-wave/per-session cost calculation from Anthropic SDK responses**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-21T03:42:58Z
- **Completed:** 2026-03-21T03:45:03Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments
- CostTracker class accumulates token usage from any Anthropic SDK response
- Model pricing table with sonnet (3/15/3.75/0.30) and haiku (1/5/1.25/0.10) per MTok
- Per-wave and per-session cost aggregation methods
- CostEntrySchema extended with optional waveNumber for wave-level cost grouping
- 9 unit tests covering all public API surface

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing tests** - `4a37616` (test)
2. **Task 1 (GREEN): Implementation** - `d2deeb5` (feat)

## Files Created/Modified
- `src/cost/pricing.ts` - ModelPricing interface, MODEL_PRICING lookup, calculateCost function
- `src/cost/tracker.ts` - CostTracker class with record, recordFromResponse, toCostReport, getWaveCost, getSessionCost
- `src/schemas/reports.ts` - Added optional waveNumber field to CostEntrySchema
- `tests/unit/cost-tracker.test.ts` - 9 unit tests for full API coverage

## Decisions Made
- Fallback to sonnet pricing for unknown model strings (safe default -- highest cost prevents underreporting)
- CostTracker stores raw TokenUsage entries and computes cost lazily via calculateCost (avoids stale pricing)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CostTracker ready for integration into High Court (04-02), Librarian (04-03), and CLI wiring (04-04)
- All downstream plans can import CostTracker from src/cost/tracker.ts and MODEL_PRICING from src/cost/pricing.ts

---
*Phase: 04-ai-review-and-audit-trail*
*Completed: 2026-03-21*
