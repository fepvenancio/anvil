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
 * Provides live progress display during builds.
 * GSD-inspired: stage banners, status symbols, progress tracking, structured layout.
 */
export class ProgressDisplay {
  private spinner: Ora | null = null;
  private silent: boolean;
  private startTime: number = Date.now();
  private waveStartTime: number = Date.now();
  private runningCost: number = 0;
  private completedTasks: number = 0;
  private totalTasks: number = 0;

  constructor(options?: { silent?: boolean }) {
    this.silent = options?.silent ?? false;
  }

  /** Set total task count for progress tracking */
  setTotalTasks(total: number): void {
    this.totalTasks = total;
  }

  /** Track cost as it accumulates */
  addCost(cost: number): void {
    this.runningCost += cost;
  }

  // ── Stage Banners ──

  printBanner(spec: string): void {
    if (this.silent) return;
    console.log('');
    console.log(chalk.cyan('━'.repeat(55)));
    console.log(chalk.cyan.bold(` ANVIL ► BUILDING`));
    console.log(chalk.dim(`  ${spec.length > 50 ? spec.slice(0, 47) + '...' : spec}`));
    console.log(chalk.cyan('━'.repeat(55)));
    console.log('');
    this.startTime = Date.now();
  }

  printPlanningBanner(): void {
    if (this.silent) return;
    console.log(chalk.cyan.bold(' ANVIL ► PLANNING'));
  }

  printValidatingBanner(): void {
    if (this.silent) return;
    console.log(chalk.cyan.bold(' ANVIL ► VALIDATING PLAN'));
  }

  printExecutionBanner(taskCount: number, waveCount: number): void {
    if (this.silent) return;
    this.totalTasks = taskCount;
    console.log('');
    console.log(chalk.cyan('━'.repeat(55)));
    console.log(chalk.cyan.bold(` ANVIL ► EXECUTING`));
    console.log(chalk.dim(`  ${taskCount} tasks across ${waveCount} waves`));
    console.log(chalk.cyan('━'.repeat(55)));
    console.log('');
  }

  // ── Wave lifecycle ──

  waveStart(waveNumber: number, totalWaves: number, taskCount: number): void {
    this.waveStartTime = Date.now();
    const progress = this._progressBar();
    const costStr = this.runningCost > 0 ? chalk.dim(`  $${this.runningCost.toFixed(2)}`) : '';
    const text = `Wave ${waveNumber}/${totalWaves} — ${taskCount} task${taskCount !== 1 ? 's' : ''}${costStr}`;

    if (!this.silent) {
      console.log('');
      console.log(chalk.cyan(`  ${progress}`));
      this.spinner = ora({
        text,
        color: 'cyan',
        prefixText: ' ',
      }).start();
    } else {
      console.log(`- ${text}`);
    }
  }

  taskStart(waveNumber: number, taskId: string): void {
    const text = `Wave ${waveNumber} | ${taskId}...`;
    if (this.spinner) {
      this.spinner.text = text;
    }
  }

  taskComplete(_waveNumber: number, taskId: string, filesWritten: number): void {
    this.completedTasks++;
    const elapsed = this._elapsed(this.waveStartTime);
    const line = chalk.green(`  ✓ ${taskId}`) + chalk.dim(` (${filesWritten} file${filesWritten !== 1 ? 's' : ''}, ${elapsed})`);
    if (this.spinner) {
      this.spinner.clear();
      console.log(line);
      this.spinner.start();
    } else {
      console.log(line);
    }
  }

  taskFailed(_waveNumber: number, taskId: string, error: string): void {
    const shortError = error.length > 60 ? error.slice(0, 57) + '...' : error;
    const line = chalk.red(`  ✗ ${taskId}`) + chalk.dim(` — ${shortError}`);
    if (this.spinner) {
      this.spinner.clear();
      console.log(line);
      this.spinner.start();
    } else {
      console.log(line);
    }
  }

  judgeResult(check: { name: string; passed: boolean; message?: string }): void {
    const icon = check.passed ? chalk.green('✓') : chalk.red('✗');
    const name = check.passed ? chalk.dim(check.name) : check.name;
    const msg = !check.passed && check.message ? chalk.dim(` — ${check.message}`) : '';
    console.log(`    ${icon} ${name}${msg}`);
  }

  waveComplete(waveNumber: number, mergedCount: number): void {
    const elapsed = this._elapsed(this.waveStartTime);
    const costStr = this.runningCost > 0 ? chalk.dim(` · $${this.runningCost.toFixed(2)}`) : '';
    if (this.spinner) {
      this.spinner.succeed(chalk.green(`Wave ${waveNumber}: ${mergedCount} merged, all judges passed`) + chalk.dim(` (${elapsed})`) + costStr);
      this.spinner = null;
    } else {
      console.log(chalk.green(`✔ Wave ${waveNumber}: ${mergedCount} merged (${elapsed})${costStr}`));
    }
  }

  waveRetry(waveNumber: number, attempt: number, maxRetries: number): void {
    const msg = `Wave ${waveNumber} retry ${attempt}/${maxRetries} — re-executing failed tasks`;
    if (this.spinner) {
      this.spinner.warn(chalk.yellow(msg));
      this.spinner = null;
    } else {
      console.log(chalk.yellow(`⚠ ${msg}`));
    }
  }

  waveHalted(waveNumber: number, reasons: string[]): void {
    const msg = `Wave ${waveNumber} halted: ${reasons.join(' and ')}`;
    if (this.spinner) {
      this.spinner.fail(chalk.red(msg));
      this.spinner = null;
    } else {
      console.log(chalk.red(`✗ ${msg}`));
    }
  }

  // ── Post-wave pipeline ──

  printFinalCheckBanner(): void {
    if (this.silent) return;
    console.log('');
    console.log(chalk.cyan.bold(' ANVIL ► FINAL INTEGRATION CHECK'));
  }

  printHighCourtBanner(): void {
    if (this.silent) return;
    console.log('');
    console.log(chalk.cyan.bold(' ANVIL ► HIGH COURT REVIEW'));
  }

  printLibrarianBanner(): void {
    if (this.silent) return;
    console.log(chalk.cyan.bold(' ANVIL ► GENERATING DOCS'));
  }

  // ── Helpers ──

  passed(text: string): string { return chalk.green(text); }
  warned(text: string): string { return chalk.yellow(text); }
  failed(text: string): string { return chalk.red(text); }
  info(text: string): string { return chalk.blue(text); }

  private _elapsed(since: number): string {
    const ms = Date.now() - since;
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  }

  private _progressBar(): string {
    if (this.totalTasks === 0) return '';
    const pct = Math.round((this.completedTasks / this.totalTasks) * 100);
    const filled = Math.round(pct / 5);
    const empty = 20 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `${bar} ${pct}% (${this.completedTasks}/${this.totalTasks})`;
  }

  // ── Completion banner ──

  printCompletionSummary(options: CompletionSummaryOptions): void {
    const { success, taskCount, waveCount, verdict, totalCost, failedAt, failedTasks } = options;
    const elapsed = this._elapsed(this.startTime);

    const width = 55;
    const pad = (text: string, len: number) => {
      const stripped = text.replace(/\u001b\[[0-9;]*m/g, '');
      const remaining = len - stripped.length;
      return remaining > 0 ? text + ' '.repeat(remaining) : text;
    };

    let borderColor: (s: string) => string;
    let header: string;

    if (success && (verdict === 'merge' || !verdict)) {
      borderColor = chalk.green;
      header = chalk.green.bold('✓ Build Complete');
    } else if (!success) {
      borderColor = chalk.red;
      header = chalk.red.bold('✗ Build Failed');
    } else {
      borderColor = chalk.yellow;
      header = chalk.yellow.bold(`! Verdict: ${verdict}`);
    }

    const top = borderColor('┌' + '─'.repeat(width) + '┐');
    const bot = borderColor('└' + '─'.repeat(width) + '┘');
    const side = (content: string) => borderColor('│') + '  ' + pad(content, width - 2) + borderColor('│');
    const empty = side('');

    console.log('');
    console.log(top);
    console.log(side(header));
    console.log(empty);
    console.log(side(`Tasks: ${taskCount} across ${waveCount} wave(s)`));
    console.log(side(`Time:  ${elapsed}`));

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
      console.log(side('  anvil status   — review build'));
      console.log(side('  anvil cost     — cost breakdown'));
      console.log(side('  anvil logs     — detailed logs'));
      console.log(side('  git push       — ship it'));
    } else if (!success) {
      if (failedAt !== undefined) {
        console.log(side(`  anvil logs --wave ${failedAt}  — inspect failure`));
      }
      console.log(side('  anvil status   — review build state'));
      console.log(side('  anvil logs     — detailed logs'));
    } else {
      console.log(side('  Check .anvil/high-court-report.json'));
      console.log(side('  anvil status   — review build state'));
    }

    console.log(bot);
    console.log('');
  }
}
