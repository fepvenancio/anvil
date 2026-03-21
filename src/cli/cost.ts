import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CostReportSchema } from '../schemas/reports.js';
import type { CostReport, CostEntry } from '../schemas/reports.js';
import { formatCostSummary } from '../cost/display.js';

/**
 * Reads and displays cost breakdown from .anvil/cost-report.json.
 * Supports --by-wave flag for per-wave grouping.
 */
export const costCommand = new Command('cost')
  .description('Show token/cost breakdown per agent and per wave')
  .option('--by-wave', 'Group cost entries by wave number')
  .action(async (opts: { byWave?: boolean }) => {
    const anvilDir = join(process.cwd(), '.anvil');
    await showCost(anvilDir, opts);
  });

export async function showCost(anvilDir: string, opts: { byWave?: boolean } = {}): Promise<string> {
  let report: CostReport;
  try {
    const raw = await readFile(join(anvilDir, 'cost-report.json'), 'utf-8');
    report = CostReportSchema.parse(JSON.parse(raw));
  } catch {
    const msg = 'No cost data found. Run `anvil run` to generate a cost report.';
    console.log(msg);
    return msg;
  }

  if (opts.byWave) {
    const output = formatByWave(report);
    console.log(output);
    return output;
  }

  const output = formatCostSummary(report);
  console.log(output);
  return output;
}

function formatByWave(report: CostReport): string {
  if (report.entries.length === 0) {
    return 'No API calls recorded.';
  }

  const lines: string[] = [];
  lines.push(chalk.bold('Cost Summary (by wave)'));
  lines.push('\u2500'.repeat(55));

  // Group entries by wave
  const waveMap = new Map<string, CostEntry[]>();
  for (const entry of report.entries) {
    const key = entry.waveNumber != null ? `Wave ${entry.waveNumber}` : 'Other';
    const group = waveMap.get(key) ?? [];
    group.push(entry);
    waveMap.set(key, group);
  }

  // Sort wave keys
  const keys = [...waveMap.keys()].sort((a, b) => {
    if (a === 'Other') return 1;
    if (b === 'Other') return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  for (const key of keys) {
    const entries = waveMap.get(key)!;
    const subtotal = entries.reduce((sum, e) => sum + e.costUsd, 0);
    lines.push(`\n${chalk.bold(key)} (${chalk.green(`$${subtotal.toFixed(4)}`)})`);
    for (const entry of entries) {
      lines.push(`  ${entry.agent.padEnd(22)} $${entry.costUsd.toFixed(4)}`);
    }
  }

  lines.push('\n' + '\u2500'.repeat(55));
  lines.push(`${'Total'.padEnd(42)}${chalk.green(`$${report.totalCostUsd.toFixed(4)}`)}`);

  return lines.join('\n');
}
