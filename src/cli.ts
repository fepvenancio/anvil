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
      console.log(chalk.blue('\nExecuting plan (parallel waves)...\n'));
      const result = await executeInWaves(reviewedPlan, config);

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
        const waveCount = result.waveReports.length;
        const taskCount = result.results.length;
        console.log(chalk.green(`\nBuild complete! ${taskCount} tasks in ${waveCount} wave(s), all judges passed.`));
      } else {
        console.log(chalk.red(`\nBuild failed at wave ${result.haltedAtWave}.`));
        if (result.failedTasks.length > 0) {
          console.log(chalk.red(`  Failed tasks: ${result.failedTasks.join(', ')}`));
        }
        // Display judge failures
        for (const report of result.judgeReports) {
          if (!report.allPassed) {
            for (const check of report.checks) {
              if (!check.passed) {
                console.log(chalk.red(`  Judge failure (wave ${report.waveNumber}): ${check.name} — ${check.message ?? 'failed'}`));
              }
            }
          }
        }
        process.exit(1);
      }
    }
  });

await program.parseAsync();
