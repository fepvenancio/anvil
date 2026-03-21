#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from './core/config-loader.js';
import { initAnvilDir } from './core/anvil-dir.js';
import { generatePlan } from './stations/planner.js';
import { promptPlanReview, displayPlanSummary } from './ui/plan-review.js';
import { executeSequentially } from './orchestrator/sequential-runner.js';
import { executeInWaves } from './orchestrator/wave-runner.js';
import { CostTracker } from './cost/tracker.js';
import { formatCostSummary } from './cost/display.js';
import { runHighCourt } from './judges/high-court.js';
import { runLibrarian } from './stations/librarian.js';
import { simpleGit } from 'simple-git';
import { ProgressDisplay } from './ui/progress.js';
import { statusCommand } from './cli/status.js';
import { costCommand } from './cli/cost.js';
import { logsCommand } from './cli/logs.js';

const program = new Command();

program
  .name('anvil')
  .description('Lightweight AI Code Factory')
  .version('0.1.0');

program
  .command('run')
  .description('Start a build from a natural-language spec')
  .argument('<spec>', 'What to build')
  .option('-w, --workers <n>', 'Max parallel workers', '4')
  .option('-m, --model <model>', 'Claude model to use')
  .option('--skip-review', 'Skip interactive plan review')
  .option('--dry-run', 'Generate plan only, do not execute')
  .option('--sequential', 'Use sequential execution instead of parallel waves')
  .action(async (spec: string, opts: Record<string, string>) => {
    const config = loadConfig(opts, process.cwd());
    const anvilDir = await initAnvilDir(process.cwd());

    console.log(chalk.bold('\nAnvil\n'));
    console.log(`  Project:     ${config.projectName}`);
    console.log(`  Model:       ${config.model}`);
    console.log(`  Max Workers: ${config.maxWorkers}`);
    console.log(`  Spec:        ${spec}`);
    console.log();

    // Phase 2: Planner -> Review -> Execute pipeline
    console.log(chalk.blue('Planning...'));
    const plan = await generatePlan(spec, config);

    // Save plan to .anvil/roadmap.json
    await writeFile(join(anvilDir, 'roadmap.json'), JSON.stringify(plan, null, 2));

    // Dry-run: display plan and exit
    if (opts.dryRun) {
      displayPlanSummary(plan);
      console.log(chalk.dim('Dry run — plan saved, not executing.'));
      return;
    }

    // Interactive review
    const { plan: reviewedPlan, approved } = await promptPlanReview(plan, {
      skipPrompt: !!opts.skipReview,
    });
    if (!approved) {
      console.log(chalk.yellow('Build cancelled by user.'));
      process.exit(0);
    }

    // Execute plan (parallel waves by default, sequential with --sequential flag)
    if (opts.sequential) {
      console.log(chalk.blue('\nExecuting plan (sequential mode)...\n'));
      const result = await executeSequentially(reviewedPlan, config);

      if (result.success) {
        console.log(chalk.green(`\nBuild complete! ${result.results.length} tasks executed successfully.`));
      } else {
        console.log(chalk.red(`\nBuild failed. ${result.failedTasks.length} task(s) failed: ${result.failedTasks.join(', ')}`));
        process.exit(1);
      }
    } else {
      const baseDir = process.cwd();
      const git = simpleGit(baseDir);
      const costTracker = new CostTracker();
      const progress = new ProgressDisplay();

      // Ensure repo has at least one commit (worktrees require HEAD to exist)
      try {
        await git.revparse(['HEAD']);
      } catch {
        await git.raw(['commit', '--allow-empty', '-m', 'chore: initial commit (anvil)']);
      }

      // Capture baseline SHA BEFORE execution (critical: HEAD moves during wave merges)
      const baselineSha = await git.revparse(['HEAD']);

      console.log(chalk.blue('\nExecuting plan (parallel waves)...\n'));
      const result = await executeInWaves(reviewedPlan, config, { costTracker, progress });

      // Save judge reports
      const reportsDir = join(anvilDir, 'reports');
      await mkdir(reportsDir, { recursive: true });
      for (const report of result.judgeReports) {
        await writeFile(
          join(reportsDir, `wave-${report.waveNumber}-judges.json`),
          JSON.stringify(report, null, 2),
        );
      }

      if (result.success) {
        // --- Post-wave pipeline ---
        console.log(chalk.blue('\nRunning High Court architectural review...\n'));
        const highCourtReport = await runHighCourt(
          baseDir, reviewedPlan, result.judgeReports, config,
          { baselineSha },
        );

        // Save High Court report
        await writeFile(
          join(anvilDir, 'high-court-report.json'),
          JSON.stringify(highCourtReport, null, 2),
        );

        if (highCourtReport.verdict === 'abort' || highCourtReport.verdict === 'human_required') {
          // EXEC-09: Rollback
          console.log(chalk.red(`\nHigh Court verdict: ${highCourtReport.verdict}`));
          console.log(chalk.red(`Reasoning: ${highCourtReport.reasoning}`));
          for (const concern of highCourtReport.concerns) {
            console.log(chalk.yellow(`  - ${concern}`));
          }
          console.log(chalk.red('\nRolling back to pre-build state...'));
          await git.reset(['--hard', baselineSha]);
          console.log(chalk.red('Rollback complete. Build artifacts removed from main.'));
        } else {
          // High Court approved — run Librarian
          console.log(chalk.green(`High Court verdict: merge`));
          console.log(chalk.blue('\nGenerating documentation...\n'));
          const docs = await runLibrarian(
            baseDir, reviewedPlan, highCourtReport, config,
          );

          // LIBR-03: Atomic commit for generated docs
          await git.add([docs.readmePath, docs.architecturePath]);
          await git.commit('docs(anvil): auto-generated README and ARCHITECTURE');
          console.log(chalk.green('Documentation generated and committed.'));
        }

        // COST-03 + COST-04: Always display and save cost report
        const sessionId = `anvil-${Date.now()}`;
        const costReport = costTracker.toCostReport(sessionId);
        await writeFile(
          join(anvilDir, 'cost-report.json'),
          JSON.stringify(costReport, null, 2),
        );
        console.log('\n' + formatCostSummary(costReport));

        // Print completion summary banner
        progress.printCompletionSummary({
          success: highCourtReport.verdict === 'merge',
          taskCount: result.results.length,
          waveCount: result.waveReports.length,
          verdict: highCourtReport.verdict,
          totalCost: costReport.totalCostUsd,
        });

        if (highCourtReport.verdict === 'abort') {
          process.exit(1);
        }
      } else {
        // Wave execution failed — still save cost report
        const sessionId = `anvil-${Date.now()}`;
        const costReport = costTracker.toCostReport(sessionId);
        await writeFile(
          join(anvilDir, 'cost-report.json'),
          JSON.stringify(costReport, null, 2),
        );
        console.log('\n' + formatCostSummary(costReport));

        // Print failure summary banner
        progress.printCompletionSummary({
          success: false,
          taskCount: result.results.length,
          waveCount: result.waveReports.length,
          failedAt: result.haltedAtWave,
          failedTasks: result.failedTasks,
          totalCost: costReport.totalCostUsd,
        });

        process.exit(1);
      }
    }
  });

program.addCommand(statusCommand);
program.addCommand(costCommand);
program.addCommand(logsCommand);

await program.parseAsync();
