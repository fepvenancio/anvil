# Feature Landscape

**Domain:** AI Agent Orchestration / Code Factory CLI
**Researched:** 2026-03-20
**Competitors Analyzed:** Forge, Cursor (parallel agents), Aider, Claude Code, Devin, OpenHands, SWE-agent, Codex CLI

## Table Stakes

Features users expect from any multi-agent code generation tool. Missing = product feels broken or toy-like.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Plan-then-execute architecture** | Every serious tool (Cursor, Devin, OpenHands) separates planning from execution. Users expect to see a plan before code is written. | Medium | Anvil already specifies this with Planner/Worker separation. Forge's core pattern. |
| **Parallel task execution** | Cursor ships 8 parallel agents via worktrees. Devin runs concurrent sandboxed tasks. Sequential-only is unacceptably slow in 2026. | High | Anvil's wave-based parallelism with git worktrees is the right approach. Must handle merge correctly. |
| **Git-native workflow** | Aider pioneered this: every AI edit = a git commit. Claude Code, Cursor, and Codex CLI all produce git history. Users expect reviewable, revertable changes. | Medium | Atomic commits per task, clear messages. Anvil already plans this. |
| **Automated test/lint validation** | Every tool runs tests after code generation. Aider auto-runs linters and fixes issues. Cursor agents run builds. Untested AI output is untrusted. | Medium | Maps to Anvil's Sub-Judges. Mechanical checks (tsc, eslint, test runner) after every wave. |
| **Human escalation / halt on uncertainty** | ESCALATE.md is becoming a standard convention. Devin pauses for human input. Claude Code asks clarifying questions. "Better to halt than guess" is expected. | Medium | Anvil's PLAN_AMBIGUOUS and PLAN_GAP are exactly this. Forge users loved it. |
| **Cost/token tracking** | Claude's Agent SDK provides per-call token breakdowns. Langfuse, TokenBar, and built-in cost dashboards are standard. Users panic about runaway costs. | Low | Anvil's Cost Auditor role. Track input/output/cache tokens per agent per wave. Expose via `anvil cost`. |
| **Session state persistence** | Claude Code saves conversations locally. LangGraph checkpoints to SQLite. Users expect to close terminal and resume. Crashed sessions must be recoverable. | Medium | Anvil needs `.anvil/` state files. JSON checkpoint after each wave. `anvil resume` command. |
| **Multi-file editing** | Table stakes since 2024. Every tool handles cross-file changes. Single-file-only tools are dead. | Low | Implicit in task-based architecture. Each Worker can touch multiple declared files. |
| **Clear output / progress indication** | Users need to see what's happening: which wave, which tasks, pass/fail status. Devin shows real-time progress. Claude Code streams output. | Low | CLI progress display: wave N/M, task status, judge verdicts. Not fancy, but present. |
| **Dependency-aware task ordering** | OpenHands and Forge both use dependency graphs. Building feature B before its dependency A is a reliability killer. | Medium | Anvil's topological sort + wave execution. Already specified. |

## Differentiators

Features that set Anvil apart. Not universally expected, but create competitive advantage.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Structured multi-judge review system** | No other lightweight CLI tool has Sub-Judges (mechanical) + High Court (AI architectural review). Cursor has no review. Aider has no review. Claude Code has no review. Devin's review is opaque. This is Forge's killer feature, simplified. | High | Sub-Judges: deterministic gates (tsc, tests, security scan, touch map). High Court: AI reads handoff summaries, dives into code only on escalation. Two-tier review is unique. |
| **Touch map enforcement** | Workers declare which files they'll modify. Undeclared writes are blocked. No other CLI tool enforces file ownership boundaries between parallel agents. Prevents the #1 multi-agent failure: conflicting writes. | Medium | Planner declares `writes[]` and `reads[]` per task. Orchestrator enforces at worktree level. Sub-Judge validates compliance. |
| **Handoff-first review** | High Court reads Worker summaries before touching code. Cheaper, faster, and more architectural than line-by-line review. Novel pattern from Forge. | Medium | Workers produce structured handoff documents. High Court triages: pass (summary sufficient), escalate (read code), or reject. |
| **Zero-setup npx experience** | `npx anvil run "Build X"` with zero prerequisites beyond Node 22. Devin requires cloud account. OpenHands requires Docker. Forge requires Docker + Python + Dolt + 40GB RAM. Cursor requires IDE installation. | Medium | Single npm package. No Docker, no Python, no database servers. This is the accessibility differentiator. |
| **Full audit trail in `.anvil/`** | Human-readable project artifacts: plan, wave results, judge reports, cost breakdown, git log. Not locked in a cloud dashboard (Devin) or ephemeral terminal output (Claude Code). Users can `cat .anvil/audit.json`. | Low | JSON files in `.anvil/`: plan, wave reports, judge verdicts, cost summary. Portable, inspectable, diffable. |
| **Ordered wave execution model** | Topological sort into waves, parallel within wave, sequential across waves, merge after each wave. More structured than Cursor's "fire 8 agents independently" approach. Prevents the merge chaos that plagues naive parallelism. | High | Wave model is more reliable than pure parallel. Each wave starts from a known-good merged state. Sub-Judges gate progression. |
| **Librarian auto-documentation** | Auto-generate README, ARCHITECTURE.md, OpenAPI specs from build artifacts. Most tools produce code but no docs. | Medium | Runs after High Court approves. Reads final codebase, generates docs. Nice-to-have but visible differentiator. |
| **Explicit Planner/Worker separation** | Planner NEVER writes code. Workers NEVER plan. Clean cognitive boundaries. Most tools blur these roles (Claude Code does everything in one agent). | Low | Architectural constraint, not a feature to build. Enforced by system prompts and role definitions. |

## Anti-Features

Features to explicitly NOT build. Tempting but wrong for Anvil's positioning.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Web UI / Dashboard** | Adds massive complexity. Devin and OpenHands have web UIs because they target teams/enterprise. Anvil targets solo devs who live in terminals. CLI-first tools (Aider, Claude Code) are winning the solo dev market. | Rich CLI output with `anvil status`, `anvil logs`, `anvil cost`. Structured JSON output for piping. |
| **Multi-model / multi-provider support** | Aider supports 100+ models but that's Aider's thing. For v1, supporting one provider well (Anthropic) beats supporting many poorly. Model abstraction layers add bugs and complexity. | Anthropic SDK only. Claude Sonnet as default. Add provider abstraction in v2 only if demanded. |
| **Docker/container sandboxing** | This is exactly what makes Forge require 40GB RAM. Git worktrees provide sufficient isolation for file conflicts. Network sandboxing is out of scope for v1's trust model. | Git worktrees for file isolation. Trust model for v1: Workers run locally with full system access. |
| **IDE integration / LSP** | Cursor owns the IDE-integrated space. Anvil competing on IDE integration is a losing battle. Terminal tools compose better with existing workflows. | Stay CLI-only. Users run `anvil` alongside their preferred editor. Unix philosophy: do one thing well. |
| **Real-time collaboration / team features** | Devin targets teams with Slack integration, shared sessions, team dashboards. Anvil targets solo devs. Team features dilute focus. | Single-user CLI. One command, one build, one result. |
| **Browser automation / web browsing** | OpenHands and Devin can browse the web. Cool but orthogonal to code generation. Massive attack surface and complexity. | Workers generate code from specs. If they need external info, that's a PLAN_GAP escalation to the human. |
| **Interactive chat / conversational mode** | Claude Code and Aider are chat-first. Anvil is command-first: you describe what to build, it builds it. Chat mode fights the "code factory" mental model. | `anvil run "spec"` is the interface. Human escalation for ambiguity. No back-and-forth chat loop. |
| **Self-healing / auto-retry loops** | Tempting to have agents retry on failure indefinitely. Creates runaway cost and hides bugs. Forge's philosophy: fail fast, escalate to human. | Sub-Judge failures halt the wave. High Court can abort the build. Bounded retries (max 1 per task) with cost caps. |
| **MCP / A2A protocol support** | Becoming standard in the ecosystem but adds protocol complexity. Anvil's agents are internal, not discoverable services. | Internal agent communication via JSON state files. No external protocol surface for v1. Consider MCP for tool access in v2. |

## Feature Dependencies

```
CLI Framework (commander)
  |
  +-> Plan Parser (JSON schema validation)
  |     |
  |     +-> Planner Station (AI: spec -> plan)
  |           |
  |           +-> Dependency Graph (topological sort)
  |                 |
  |                 +-> Wave Orchestrator
  |                       |
  |                       +-> Worker Station (git worktree + AI execution)
  |                       |     |
  |                       |     +-> Touch Map Enforcement
  |                       |     +-> Atomic Commit
  |                       |     +-> Handoff Document
  |                       |
  |                       +-> Worktree Merge (after wave)
  |                             |
  |                             +-> Sub-Judges (mechanical checks)
  |                                   |
  |                                   +-> [Next Wave or High Court]
  |
  +-> High Court (AI: architectural review)
  |     |
  |     +-> Librarian (auto-docs)
  |
  +-> Cost Auditor (token tracking, runs throughout)
  |
  +-> State Persistence (.anvil/ JSON files)
  |     |
  |     +-> Resume capability
  |
  +-> Human Escalation (PLAN_AMBIGUOUS, PLAN_GAP)
        [can trigger at Planner or Worker stage]
```

## MVP Recommendation

**Phase 1 - Core Loop (must work end-to-end):**
1. CLI framework with `run` command
2. Planner Station (spec -> JSON plan with tasks + dependencies)
3. Worker Station (single worker, git worktree, atomic commits)
4. Sequential execution (waves of 1) -- prove the loop works
5. Basic cost tracking (token counts per call)
6. State persistence (`.anvil/` with plan + results)

**Phase 2 - Parallelism + Quality Gates:**
1. Dependency graph + topological sort into waves
2. Parallel workers within waves (default 4)
3. Worktree merge after each wave
4. Sub-Judges (tsc, test runner, touch map compliance)
5. Touch map enforcement

**Phase 3 - Intelligence Layer:**
1. High Court (AI architectural review with handoff-first pattern)
2. Human escalation (PLAN_AMBIGUOUS, PLAN_GAP)
3. Handoff documents from Workers
4. Full audit trail

**Phase 4 - Polish:**
1. Librarian (auto-docs)
2. `resume`, `status`, `cost`, `logs`, `cancel` commands
3. `ship --pr` (create GitHub PR from build)
4. Rich CLI progress display

**Defer to v2:**
- Multi-model support
- MCP tool access for Workers
- Configuration file (`.anvilrc`)
- Plugin system for custom Sub-Judges
- `anvil plan` (plan-only mode for review before execution)

## Competitive Positioning Matrix

| Capability | Anvil | Cursor | Aider | Claude Code | Devin | OpenHands |
|------------|-------|--------|-------|-------------|-------|-----------|
| Multi-agent parallel | Waves | 8 agents | No | No | Yes (cloud) | Yes |
| Structured review | 2-tier judges | No | No | No | Opaque | No |
| Git-native | Yes | Yes | Yes | Yes | Yes | Partial |
| Zero-setup | npx | IDE install | pip | pip/npm | Cloud signup | Docker |
| Cost tracking | Built-in | Credit-based | No | Basic | ACU-based | No |
| Human escalation | PLAN_GAP | Manual | Manual | Chat | Slack/web | Manual |
| Touch map / file ownership | Yes | No | No | No | No | No |
| Audit trail | .anvil/ files | No | Git only | Local chat | Cloud dashboard | No |
| CLI-first | Yes | No (IDE) | Yes | Yes | No (web) | No (web) |

## Sources

- [Best AI Coding Agents 2026 - Codegen](https://codegen.com/blog/best-ai-coding-agents/)
- [AI Coding Tools Compared 2026 - TLDL](https://www.tldl.io/resources/ai-coding-tools-2026)
- [Cursor Parallel Agents Docs](https://cursor.com/docs/configuration/worktrees)
- [Aider Git Integration](https://aider.chat/docs/git.html)
- [OpenHands Platform](https://openhands.dev/)
- [ESCALATE.md Protocol](https://escalate.md/)
- [AI Coding Agents: Coherence Through Orchestration - Mike Mason](https://mikemason.ca/writing/ai-coding-agents-jan-2026/)
- [Claude Agent SDK Cost Tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
- [Devin Alternatives - Augment Code](https://www.augmentcode.com/tools/best-devin-alternatives)
- [Multi-Agent Orchestration Guide - Codebridge](https://www.codebridge.tech/articles/mastering-multi-agent-orchestration-coordination-is-the-new-scale-frontier)
- [10 Things Developers Want from Agentic IDEs - RedMonk](https://redmonk.com/kholterhoff/2025/12/22/10-things-developers-want-from-their-agentic-ides-in-2025/)
- [AI Agent Workflow Checkpointing - Zylos Research](https://zylos.ai/research/2026-03-04-ai-agent-workflow-checkpointing-resumability)
