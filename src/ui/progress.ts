import chalk from 'chalk';
import ora, { type Ora } from 'ora';

export interface CompletionSummaryOptions {
  success: boolean;
  taskCount: number;
  waveCount: number;
  verdict?: string;
  totalCost?: number;
  failedAt?: number;
  failedTasks?: string[];
}

/**
 * Provides live progress display during builds: ora spinners, color-coded
 * status output, and a polished completion summary banner.
 */
export class ProgressDisplay {
  private spinner: Ora | null = null;
  private silent: boolean;

  constructor(options?: { silent?: boolean }) {
    this.silent = options?.silent ?? false;
  }

  // --- Wave lifecycle methods (CLUX-01) ---

  waveStart(waveNumber: number, totalWaves: number, taskCount: number): void {
    const text = `Wave ${waveNumber}/${totalWaves} — ${taskCount} task${taskCount !== 1 ? 's' : ''}`;
    if (!this.silent) {
      this.spinner = ora({
        text: chalk.cyan(text),
        color: 'cyan',
      }).start();
    } else {
      console.log(chalk.cyan(text));
    }
  }

  taskStart(waveNumber: number, taskId: string): void {
    const text = `Wave ${waveNumber} | ${taskId}...`;
    if (this.spinner) {
      this.spinner.text = text;
    }
  }

  taskComplete(_waveNumber: number, taskId: string, filesWritten: number): void {
    const line = chalk.green(`  \u2713 ${taskId} (${filesWritten} file${filesWritten !== 1 ? 's' : ''})`);
    if (this.spinner) {
      this.spinner.clear();
      console.log(line);
      this.spinner.start();
    } else {
      console.log(line);
    }
  }

  taskFailed(_waveNumber: number, taskId: string, error: string): void {
    const line = chalk.red(`  \u2717 ${taskId} \u2014 ${error}`);
    if (this.spinner) {
      this.spinner.clear();
      console.log(line);
      this.spinner.start();
    } else {
      console.log(line);
    }
  }

  judgeResult(check: { name: string; passed: boolean; message?: string }): void {
    const line = check.passed
      ? chalk.green(`  \u2713 Judge: ${check.name}`)
      : chalk.red(`  \u2717 Judge: ${check.name} \u2014 ${check.message ?? 'FAILED'}`);
    console.log(line);
  }

  waveComplete(waveNumber: number, mergedCount: number): void {
    if (this.spinner) {
      this.spinner.succeed(chalk.green(`Wave ${waveNumber} complete: ${mergedCount} merged, all judges passed`));
      this.spinner = null;
    } else {
      console.log(chalk.green(`Wave ${waveNumber} complete: ${mergedCount} merged, all judges passed`));
    }
  }

  waveRetry(waveNumber: number, attempt: number, maxRetries: number): void {
    const msg = `Wave ${waveNumber} retry ${attempt}/${maxRetries} — re-executing failed tasks`;
    if (this.spinner) {
      this.spinner.warn(chalk.yellow(msg));
      this.spinner = null;
    } else {
      console.log(chalk.yellow(msg));
    }
  }

  waveHalted(waveNumber: number, reasons: string[]): void {
    const msg = `Wave ${waveNumber} halted: ${reasons.join(' and ')}`;
    if (this.spinner) {
      this.spinner.fail(chalk.yellow(msg));
      this.spinner = null;
    } else {
      console.log(chalk.yellow(msg));
    }
  }

  // --- Color helpers (CLUX-02) ---

  passed(text: string): string {
    return chalk.green(text);
  }

  warned(text: string): string {
    return chalk.yellow(text);
  }

  failed(text: string): string {
    return chalk.red(text);
  }

  info(text: string): string {
    return chalk.blue(text);
  }

  // --- Completion banner (CLUX-03) ---

  printCompletionSummary(options: CompletionSummaryOptions): void {
    const { success, taskCount, waveCount, verdict, totalCost, failedAt, failedTasks } = options;

    const width = 39;
    const pad = (text: string, len: number) => {
      // Strip ANSI codes for length calculation
      const stripped = text.replace(/\u001b\[[0-9;]*m/g, '');
      const remaining = len - stripped.length;
      return remaining > 0 ? text + ' '.repeat(remaining) : text;
    };

    let borderColor: (s: string) => string;
    let header: string;

    if (success && (verdict === 'merge' || !verdict)) {
      borderColor = chalk.green;
      header = chalk.green.bold('\u2713 Build Complete');
    } else if (!success) {
      borderColor = chalk.red;
      header = chalk.red.bold('\u2717 Build Failed');
    } else {
      // human_required or abort
      borderColor = chalk.yellow;
      header = chalk.yellow.bold(`! Verdict: ${verdict}`);
    }

    const top = borderColor('\u250c' + '\u2500'.repeat(width) + '\u2510');
    const bot = borderColor('\u2514' + '\u2500'.repeat(width) + '\u2518');
    const side = (content: string) => borderColor('\u2502') + '  ' + pad(content, width - 2) + borderColor('\u2502');
    const empty = side('');

    console.log('');
    console.log(top);
    console.log(side(header));
    console.log(empty);

    console.log(side(`Tasks: ${taskCount} across ${waveCount} wave(s)`));

    if (verdict) {
      console.log(side(`Verdict: ${verdict}`));
    }

    if (totalCost !== undefined) {
      console.log(side(`Cost: $${totalCost.toFixed(4)}`));
    }

    if (!success && failedAt !== undefined) {
      console.log(side(`Failed at: wave ${failedAt}`));
    }

    if (!success && failedTasks && failedTasks.length > 0) {
      console.log(side(`Failed: ${failedTasks.join(', ')}`));
    }

    console.log(empty);
    console.log(side('Next steps:'));

    if (success && (verdict === 'merge' || !verdict)) {
      console.log(side('  anvil status   \u2014 review build'));
      console.log(side('  anvil cost     \u2014 cost breakdown'));
      console.log(side('  anvil logs     \u2014 detailed logs'));
      console.log(side('  git push       \u2014 ship it'));
    } else if (!success) {
      if (failedAt !== undefined) {
        console.log(side(`  anvil logs --wave ${failedAt}  \u2014 inspect failure`));
      }
      console.log(side('  anvil status   \u2014 review build state'));
      console.log(side('  anvil logs     \u2014 detailed logs'));
    } else {
      // human_required / abort
      console.log(side('  Check .anvil/high-court-report.json'));
      console.log(side('  anvil status   \u2014 review build state'));
    }

    console.log(bot);
    console.log('');
  }
}
