import { query } from '@anthropic-ai/claude-agent-sdk';
import { HighCourtReportSchema, type HighCourtReport, type SubJudgeReport } from '../schemas/reports.js';
import type { Plan } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';
import { HIGH_COURT_SYSTEM_PROMPT } from '../prompts/high-court-system.js';
import { simpleGit } from 'simple-git';

export interface RunHighCourtOptions {
  /** Git SHA to diff against. Defaults to HEAD~1. */
  baselineSha?: string;
}

/**
 * Runs the High Court architectural review using Claude Code Agent SDK.
 * Auth is inherited from the parent CLI environment.
 *
 * Reads the build context (git diff, plan spec, Sub-Judge reports),
 * calls Claude, and returns a HighCourtReport with a merge/human_required/abort verdict.
 */
export async function runHighCourt(
  projectDir: string,
  plan: Plan,
  judgeReports: SubJudgeReport[],
  config: AnvilConfig,
  options?: RunHighCourtOptions,
): Promise<HighCourtReport> {
  const baselineSha = options?.baselineSha ?? 'HEAD~1';

  // Get git diff context
  const git = simpleGit(projectDir);
  const diffStat = await git.diff(['--stat', baselineSha, 'HEAD']);
  let fullDiff = await git.diff([baselineSha, 'HEAD']);

  // Truncate full diff if too large
  const MAX_DIFF_CHARS = 50000;
  if (fullDiff.length > MAX_DIFF_CHARS) {
    fullDiff = fullDiff.slice(0, MAX_DIFF_CHARS) + '\n\n... [diff truncated at 50000 chars]';
  }

  // Build task list
  const taskList = plan.tasks
    .map((t) => `- ${t.id}: ${t.description} (writes: ${t.writes.join(', ')})`)
    .join('\n');

  // Build judge report section
  const judgeSection = judgeReports
    .map((r) => {
      const checks = r.checks
        .map((c) => `  - ${c.name}: ${c.passed ? 'PASSED' : 'FAILED'}${c.message ? ` — ${c.message}` : ''}`)
        .join('\n');
      return `### Wave ${r.waveNumber} (${r.allPassed ? 'all passed' : 'FAILURES'})\n${checks}`;
    })
    .join('\n\n');

  const prompt = `## Original Spec
${plan.spec}

## Tasks
${taskList}

## Git Diff Summary
${diffStat}

## Git Diff (truncated if large)
${fullDiff}

## Sub-Judge Reports
${judgeSection}

IMPORTANT: Respond with ONLY a valid JSON object matching this exact schema. No markdown, no code fences, no explanation — just the raw JSON.

Schema:
{
  "verdict": "merge" | "human_required" | "abort",
  "reasoning": "string (explanation of verdict)",
  "concerns": ["string (architectural concerns found)"],
  "invariantChecks": [
    {
      "name": "string (what was checked)",
      "passed": boolean,
      "detail": "string (optional explanation)"
    }
  ]
}`;

  const conversation = query({
    prompt,
    options: {
      systemPrompt: HIGH_COURT_SYSTEM_PROMPT,
      model: config.model,
      maxTurns: 3,
      permissionMode: 'bypassPermissions',
      tools: [],
    },
  });

  let resultText = '';
  for await (const message of conversation) {
    if (message.type === 'result' && message.subtype === 'success') {
      resultText = message.result;
    }
  }

  if (!resultText) {
    throw new Error('High Court produced no output');
  }

  // Extract JSON from response
  const jsonMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, resultText];
  const jsonStr = (jsonMatch[1] ?? resultText).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    // Return a safe fallback instead of crashing the pipeline
    return {
      verdict: 'human_required' as const,
      reasoning: 'High Court returned unparseable response',
      concerns: [],
      invariantChecks: [],
      timestamp: new Date().toISOString(),
    };
  }
  const parseResult = HighCourtReportSchema.safeParse(parsed);
  if (!parseResult.success) {
    throw new Error(`High Court output failed schema validation: ${parseResult.error.message}`);
  }

  return parseResult.data;
}
