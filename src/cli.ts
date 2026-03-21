#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from './core/config-loader.js';
import { initAnvilDir } from './core/anvil-dir.js';

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
  .action(async (spec: string, opts: Record<string, string>) => {
    const config = loadConfig(opts, process.cwd());

    await initAnvilDir(process.cwd());

    console.log(chalk.bold('\nAnvil\n'));
    console.log(`  Project:     ${config.projectName}`);
    console.log(`  Model:       ${config.model}`);
    console.log(`  Max Workers: ${config.maxWorkers}`);
    console.log(`  Spec:        ${spec}`);
    console.log();
  });

await program.parseAsync();
