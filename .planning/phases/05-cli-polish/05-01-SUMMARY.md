---
phase: 05-cli-polish
plan: 01
subsystem: cli
tags: [cli, status, cost, logs, commands]
dependency_graph:
  requires: [schemas/reports, cost/display, core/anvil-dir, core/logger]
  provides: [cli/status, cli/cost, cli/logs]
  affects: [cli.ts]
tech_stack:
  added: []
  patterns: [commander-subcommands, pino-log-parsing, zod-schema-validation]
key_files:
  created:
    - src/cli/status.ts
    - src/cli/cost.ts
    - src/cli/logs.ts
    - tests/unit/cli-status.test.ts
    - tests/unit/cli-cost.test.ts
    - tests/unit/cli-logs.test.ts
  modified:
    - src/cli.ts
decisions:
  - Exported showStatus/showCost/showLogs functions for testability (Commander action delegates to pure function)
  - Log level filter uses >= threshold (--level warn shows warn + error + fatal)
  - Wave grouping in cost puts entries without waveNumber into "Other" group
metrics:
  duration: 3min
  completed: "2026-03-21T04:38:00Z"
  tasks: 2
  files: 7
---

# Phase 05 Plan 01: Status, Cost, and Logs CLI Subcommands Summary

Three read-only CLI subcommands (`anvil status`, `anvil cost`, `anvil logs`) that surface .anvil/ build artifacts with filtering, color-coded output, and graceful missing-file handling.

## What Was Built

### Task 1: Command Modules (df274de)

Created three Commander subcommand modules under `src/cli/`:

- **status.ts**: Reads `wave-*-judges.json` and `high-court-report.json` from `.anvil/`. Displays wave progress with pass/fail icons (chalk green/red), High Court verdict color-coded by outcome (green=merge, yellow=human_required, red=abort). Parses through Zod schemas for type safety.

- **cost.ts**: Reads `cost-report.json`, reuses `formatCostSummary` from `src/cost/display.ts`. Adds `--by-wave` flag that groups CostEntry records by waveNumber with per-wave subtotals. Entries without a wave number go into "Other" group.

- **logs.ts**: Reads `.anvil/logs/anvil.log` (pino newline-delimited JSON). Supports `--wave <n>`, `--task <id>`, `--level <level>`, and `-n <lines>` filters. Level filter uses >= threshold. Formats each entry with timestamp (HH:MM:SS), colored level, message, and optional wave/task metadata.

All three handle missing `.anvil/` data gracefully with helpful messages.

### Task 2: CLI Wiring and Tests (3aa2436)

- Wired all three commands into `src/cli.ts` via `program.addCommand()`.
- Created 18 unit tests across 3 test files:
  - **cli-status.test.ts** (6 tests): empty state, wave progress, failed checks, High Court verdict/concerns, combined state
  - **cli-cost.test.ts** (4 tests): missing file, agent display, --by-wave grouping, empty entries
  - **cli-logs.test.ts** (8 tests): missing/empty log file, formatted display, wave filter, task filter, tail limit, level filter, no-match message

## Verification Results

- `npx tsc --noEmit` -- passed (zero errors)
- `npx vitest run` -- 165/165 tests passing across 26 test files
- `npx tsx src/cli.ts status --help` -- shows help text
- `npx tsx src/cli.ts cost --help` -- shows help text with --by-wave option
- `npx tsx src/cli.ts logs --help` -- shows help text with all filter options

## Deviations from Plan

None -- plan executed exactly as written.

## Known Stubs

None -- all commands are fully wired to .anvil/ artifact files.
