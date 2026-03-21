---
name: anvil
description: Build entire projects from a single natural-language command using Anvil AI code factory. Orchestrates Planner → Workers → Judges → High Court pipeline. Use when asked to "build", "create a project", "scaffold", or "generate" a complete application from a spec.
allowed-tools:
  - Bash
  - Read
  - Glob
---

# Anvil — AI Code Factory

Build complete, reviewed projects from a single spec using `anvil-ai`.

## When to Use

Use this skill when the user wants to:
- Build an entire project from scratch ("build a todo API", "create a calculator CLI")
- Generate a complete application with tests, types, and documentation
- Scaffold a new project with a specific stack (TypeScript, Python, Go, React)

## When NOT to Use

- For editing existing files (use normal Claude Code tools instead)
- For single-file changes or bug fixes
- For questions about code (just answer directly)

## How to Run

### Step 1: Ensure clean directory

The user should be in an empty directory (or a git repo where they want the project generated). If not, create one:

```bash
mkdir <project-name> && cd <project-name> && git init
```

### Step 2: Run Anvil

```bash
npx anvil-ai@latest run "<user's spec>" --skip-review
```

**With options:**
```bash
# Use a specific stack
npx anvil-ai@latest run "<spec>" --stack python --skip-review

# Read spec from file
npx anvil-ai@latest run "<spec>" --spec requirements.md --skip-review

# Interactive plan review (let user approve/edit the plan)
npx anvil-ai@latest run "<spec>"
```

### Step 3: Report results

After Anvil completes, read the output and report:
- Whether the build succeeded or failed
- How many waves/tasks completed
- Total cost
- If failed: read `.anvil/reports/wave-*-judges.json` to diagnose

## Available Stack Presets

| Preset | Stack |
|--------|-------|
| `typescript` (default) | TypeScript 5.x + Node 22 + Vitest + Zod |
| `python` | Python 3.12+ + FastAPI + pytest + Pydantic |
| `go` | Go 1.22+ + Chi + stdlib testing |
| `react` | React 19 + Vite + TypeScript + Vitest |

## Troubleshooting

If Anvil fails:
1. Check the judge reports: `cat .anvil/reports/wave-*-judges.json`
2. Common issues:
   - **tsc failure**: Usually missing types or wrong imports — Anvil will retry 2x automatically
   - **touch-map failure**: Worker created files outside its declared scope
   - **security failure**: Generated code has eval(), hardcoded secrets, etc.
3. Re-run with `--skip-review` to try again (plans are non-deterministic)

## Example Interactions

**User:** "Build me a REST API for managing books"
**Action:** Run `npx anvil-ai@latest run "Build a REST API for managing books with CRUD endpoints, Express, TypeScript, Zod validation, and vitest tests" --skip-review`

**User:** "Create a Python CLI tool for converting CSV to JSON"
**Action:** Run `npx anvil-ai@latest run "Build a Python CLI tool that converts CSV files to JSON" --stack python --skip-review`

**User:** "Build a React dashboard for displaying analytics"
**Action:** Run `npx anvil-ai@latest run "Build a React dashboard with charts for displaying analytics data" --stack react --skip-review`
