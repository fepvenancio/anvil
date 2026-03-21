import chalk from 'chalk';
import type { CostReport } from '../schemas/reports.js';

/**
 * Format a token count for display: numbers >= 1000 get K suffix.
 */
function formatTokens(count: number): string {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}

/**
 * Formats a CostReport for terminal display as a readable table.
 */
export function formatCostSummary(report: CostReport): string {
  if (report.entries.length === 0) {
    return 'No API calls recorded.';
  }

  const lines: string[] = [];

  lines.push(chalk.bold('Cost Summary'));
  lines.push('\u2500'.repeat(55));
  lines.push(
    `${'Agent'.padEnd(22)}${'Tokens (in/out)'.padEnd(20)}${'Cost'}`,
  );

  for (const entry of report.entries) {
    const agent = entry.agent.padEnd(22);
    const tokens = `${formatTokens(entry.inputTokens)} / ${formatTokens(entry.outputTokens)}`.padEnd(20);
    const cost = `$${entry.costUsd.toFixed(4)}`;
    lines.push(`${agent}${tokens}${cost}`);
  }

  lines.push('\u2500'.repeat(55));
  lines.push(
    `${'Total'.padEnd(42)}${chalk.green(`$${report.totalCostUsd.toFixed(4)}`)}`,
  );

  return lines.join('\n');
}
