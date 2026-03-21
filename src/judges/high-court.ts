import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { HighCourtReportSchema, type HighCourtReport, type SubJudgeReport } from '../schemas/reports.js';
import type { Plan } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';
import { HIGH_COURT_SYSTEM_PROMPT } from '../prompts/high-court-system.js';
import { simpleGit } from 'simple-git';

/** Optional CostTracker interface to avoid hard dependency on cost module. */
interface CostTrackerLike {
  recordFromResponse(
    response: { usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } },
    agent: string,
    model: string,
    waveNumber?: number,
  ): void;
}

export interface RunHighCourtOptions {
  /** Pre-configured Anthropic client (useful for testing). */
  client?: Anthropic;
  /** Git SHA to diff against. Defaults to HEAD~1. */
  baselineSha?: string;
  /** Optional cost tracker for recording token usage. */
  costTracker?: CostTrackerLike;
}

/**
 * Runs the High Court architectural review.
 *
 * Reads the build context (git diff, plan spec, Sub-Judge reports),
 * calls Claude with structured output, and returns a HighCourtReport
 * with a merge/human_required/abort verdict.
 */
export async function runHighCourt(
  projectDir: string,
  plan: Plan,
  judgeReports: SubJudgeReport[],
  config: AnvilConfig,
  options?: RunHighCourtOptions,
): Promise<HighCourtReport> {
  const client = options?.client ?? new Anthropic();
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

  // Build user message
  const taskList = plan.tasks
    .map((t) => `- ${t.id}: ${t.description} (writes: ${t.writes.join(', ')})`)
    .join('\n');

  const judgeSection = judgeReports
    .map((r) => {
      const checks = r.checks
        .map((c) => `  - ${c.name}: ${c.passed ? 'PASSED' : 'FAILED'}${c.message ? ` — ${c.message}` : ''}`)
        .join('\n');
      return `### Wave ${r.waveNumber} (${r.allPassed ? 'all passed' : 'FAILURES'})\n${checks}`;
    })
    .join('\n\n');

  const userMessage = `## Original Spec
${plan.spec}

## Tasks
${taskList}

## Git Diff Summary
${diffStat}

## Git Diff (truncated if large)
${fullDiff}

## Sub-Judge Reports
${judgeSection}`;

  // Call Claude with structured output
  const response = await (client.messages as any).parse({
    model: config.model,
    max_tokens: 4096,
    system: HIGH_COURT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    output_config: { format: zodOutputFormat(HighCourtReportSchema) },
  });

  // Record cost if tracker provided
  options?.costTracker?.recordFromResponse(response, 'high-court', config.model);

  // Extract parsed output
  const report: HighCourtReport | null | undefined = response.parsed_output;

  if (!report) {
    throw new Error('High Court produced no output — parsed_output is null');
  }

  return report;
}
