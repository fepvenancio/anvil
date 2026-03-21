# REQUIREMENTS — Anvil v1 (MVP)

## Must have (Forge magic)
- CLI: init, run <spec>, status, cost, logs, resume, cancel
- Planner Station (XML roadmap)
- Worker Stations (git worktrees + child_process)
- Parallel Sub-Judges + High Court
- Librarian + Cost Auditor + full git audit trail
- Human escalation hook

## Must NOT have
- Docker
- Python gates
- Dolt server
- pnpm monorepo / workspaces
- Streamlit dashboard
- 40 GB RAM requirement

Tech: Node 22+, pure TypeScript, @anthropic-ai/sdk, simple-git, better-sqlite3 (optional).