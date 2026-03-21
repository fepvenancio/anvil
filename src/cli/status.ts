import { Command } from 'commander';
import chalk from 'chalk';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SubJudgeReportSchema, HighCourtReportSchema } from '../schemas/reports.js';
import type { SubJudgeReport, HighCourtReport } from '../schemas/reports.js';

/**
 * Reads and displays the build status from .anvil/ artifacts:
 * - Wave progress from reports/wave-*-judges.json
 * - High Court verdict from high-court-report.json
 */
export const statusCommand = new Command('status')
  .description('Show last build state with wave progress and judge verdicts')
  .action(async () => {
    const anvilDir = join(process.cwd(), '.anvil');
    await showStatus(anvilDir);
  });

export async function showStatus(anvilDir: string): Promise<string> {
  const lines: string[] = [];

  // Read wave judge reports
  let waveReports: SubJudgeReport[] = [];
  const reportsDir = join(anvilDir, 'reports');
  try {
    const files = await readdir(reportsDir);
    const judgeFiles = files.filter(f => /^wave-\d+-judges\.json$/.test(f)).sort();
    for (const file of judgeFiles) {
      const raw = await readFile(join(reportsDir, file), 'utf-8');
      const parsed = SubJudgeReportSchema.parse(JSON.parse(raw));
      waveReports.push(parsed);
    }
  } catch {
    // reports dir may not exist
  }

  // Read High Court report
  let highCourt: HighCourtReport | null = null;
  try {
    const raw = await readFile(join(anvilDir, 'high-court-report.json'), 'utf-8');
    highCourt = HighCourtReportSchema.parse(JSON.parse(raw));
  } catch {
    // may not exist
  }

  // No data at all
  if (waveReports.length === 0 && !highCourt) {
    const msg = 'No build data found. Run `anvil run` to start a build.';
    console.log(msg);
    return msg;
  }

  // Header
  lines.push(chalk.bold('Build Status'));
  lines.push('\u2500'.repeat(55));

  // Wave progress
  if (waveReports.length > 0) {
    lines.push(chalk.bold('\nWave Progress:'));
    for (const report of waveReports) {
      const passed = report.checks.filter(c => c.passed).length;
      const total = report.checks.length;
      const status = report.allPassed
        ? chalk.green('\u2713 all passed')
        : chalk.red(`\u2717 ${total - passed}/${total} failed`);

      lines.push(`  Wave ${report.waveNumber}: ${status}`);

      for (const check of report.checks) {
        const icon = check.passed ? chalk.green('\u2713') : chalk.red('\u2717');
        const msg = check.message ? ` - ${check.message}` : '';
        lines.push(`    ${icon} ${check.name}${msg}`);
      }
    }
  }

  // High Court verdict
  if (highCourt) {
    lines.push(chalk.bold('\nHigh Court Verdict:'));
    const verdictColor = highCourt.verdict === 'merge'
      ? chalk.green
      : highCourt.verdict === 'human_required'
        ? chalk.yellow
        : chalk.red;
    lines.push(`  ${verdictColor(highCourt.verdict.toUpperCase())}`);
    lines.push(`  ${highCourt.reasoning}`);
    if (highCourt.concerns.length > 0) {
      lines.push(chalk.yellow('  Concerns:'));
      for (const concern of highCourt.concerns) {
        lines.push(chalk.yellow(`    - ${concern}`));
      }
    }
  }

  const output = lines.join('\n');
  console.log(output);
  return output;
}
