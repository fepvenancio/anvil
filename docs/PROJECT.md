# PROJECT: Anvil — Lightweight GSD-Powered Code Factory

Vision (same as original Forge):
"Build anything. Track everything. Trust the output."

Anvil is the spiritual successor to Forge (https://github.com/fepvenancio/forge). It runs a structured team of AI agents and produces reviewable PRs with full audit trails.

Keep the exact Forge agent roles and flow:
- Planner → produces XML roadmap + touch map (never writes code)
- Workers → isolated git worktrees + atomic commits
- Sub-Judges → parallel syntax/lint/test gates
- High Court → final architectural invariants review
- Librarian → auto-updates docs on commits
- Cost Auditor → token/cost reporting

Radical simplification rules:
- Pure TypeScript CLI only (`npx anvil@latest run "..."`)
- No Docker, no Python, no Dolt, no monorepo, no Streamlit
- Use git worktrees for isolation
- JSON + SQLite for state
- One-command install and use

Target: solo devs who loved Forge's power but hated the setup.