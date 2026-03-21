# Anvil

**Lightweight AI Code Factory** — Build anything. Track everything. Trust the output.

Anvil is a pure TypeScript CLI that orchestrates a team of AI agents to build entire projects from a single command. Spiritual successor to [Forge](https://github.com/fepvenancio/forge) — same structured agent roles, same review rigor, radically simplified.

```bash
npx anvil run "Build a REST API for a todo app"
```

> Under active development. Coming soon to npm.

---

## What It Does

You describe what to build. Anvil handles the rest:

1. **Planner** analyzes your spec and produces a validated execution plan
2. **Workers** execute tasks in parallel, each in an isolated git worktree
3. **Sub-Judges** run mechanical checks after every wave (tsc, tests, touch-map compliance)
4. **High Court** performs a final AI architectural review (merge / escalate / abort)
5. **Librarian** auto-generates README and ARCHITECTURE docs
6. **Cost Auditor** tracks every token spent

Every change is an atomic git commit. Bad architecture gets rolled back. You get a complete project with clean history and full audit trail.

## Architecture

```
Spec ──► Planner ──► Plan Review (Y/n/edit)
                         │
                    ┌────▼────┐
                    │  Wave 1  │  Independent tasks run in parallel
                    │ Workers  │  Each in isolated git worktree
                    └────┬────┘
                         │
                    Sub-Judges ──► tsc / vitest / touch-map
                         │
                    ┌────▼────┐
                    │  Wave 2  │  Dependent tasks execute next
                    │ Workers  │
                    └────┬────┘
                         │
                    Sub-Judges
                         │
                    High Court ──► merge / human_required / abort
                         │
                    Librarian ──► README.md + ARCHITECTURE.md
                         │
                    Cost Report ──► .anvil/cost-report.json
```

## Key Principles

- **Pure TypeScript** — No Docker, no Python, no Dolt. Node 22+ and an API key.
- **Git worktrees for isolation** — Each task gets its own worktree. No merge conflicts.
- **Planner never writes code** — Workers never plan. Clean separation.
- **Touch maps enforce scope** — Workers can only modify declared files.
- **Fail fast, escalate to human** — Better to halt than guess.
- **Ordered waves** — Topological sort eliminates coordination bugs entirely.

## Commands

```bash
anvil run "spec"     # Build from natural language
anvil status         # View build state + audit trail
anvil cost           # Token/cost breakdown per agent per wave
anvil logs           # Detailed build logs (--wave, --task, --level filters)
```

## Development

```bash
git clone https://github.com/fepvenancio/anvil.git
cd anvil
npm install
npm test              # 177 tests
npm run typecheck     # strict mode, zero errors
npm run dev -- run "Build a hello world Express app"
```

Requires `ANTHROPIC_API_KEY` environment variable for `run` command.

## Project Status

**v1 complete** — 5 phases, 37 requirements, 177 tests.

| Component | Status |
|-----------|--------|
| CLI (run, status, cost, logs) | ✓ |
| Planner Station | ✓ |
| Worker + Git Worktrees | ✓ |
| Parallel Wave Execution | ✓ |
| Sub-Judge Panel (tsc, vitest, touch-map) | ✓ |
| High Court AI Review | ✓ |
| Librarian (auto-docs) | ✓ |
| Cost Tracking | ✓ |
| Live Progress Display | ✓ |

## License

MIT
