import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { type Plan } from '../schemas/plan.js';
import { validatePlanFull } from '../core/validator.js';
import chalk from 'chalk';

export interface PlanReviewOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  skipPrompt?: boolean;
}

/**
 * Prompts the user to review a plan before execution.
 * Supports Y (approve, default), n (cancel), edit (open in $EDITOR).
 */
export async function promptPlanReview(
  plan: Plan,
  options?: PlanReviewOptions,
): Promise<{ plan: Plan; approved: boolean }> {
  if (options?.skipPrompt) {
    return { plan, approved: true };
  }

  const output = (options?.output ?? process.stdout) as NodeJS.WritableStream;
  displayPlanSummary(plan, output);

  const rl = createInterface({
    input: (options?.input ?? process.stdin) as NodeJS.ReadableStream,
    output,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question('Review plan before starting execution? (Y/n/edit) ', resolve);
  });
  rl.close();

  const trimmed = answer.trim().toLowerCase();

  if (trimmed === 'n') {
    return { plan, approved: false };
  }

  if (trimmed === 'edit' || trimmed === 'e') {
    const editedPlan = await editPlanInEditor(plan);
    return { plan: editedPlan, approved: true };
  }

  // Default: Y (approve)
  return { plan, approved: true };
}

/**
 * Opens the plan in $EDITOR for manual editing, then re-validates.
 */
export async function editPlanInEditor(plan: Plan): Promise<Plan> {
  const tmpFile = join(tmpdir(), `anvil-plan-${randomUUID()}.json`);
  await writeFile(tmpFile, JSON.stringify(plan, null, 2));

  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(editor, [tmpFile], { stdio: 'inherit' });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error('Editor timed out after 120 seconds'));
      }, 120_000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Editor exited with code ${code}`));
        } else {
          resolve();
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const raw = await readFile(tmpFile, 'utf-8');
    const edited = JSON.parse(raw);

    const result = validatePlanFull(edited);
    if (!result.valid) {
      throw new Error(`Edited plan is invalid: ${result.errors?.join(', ')}`);
    }

    return result.plan!;
  } finally {
    // Best effort cleanup of temp file
    try {
      await unlink(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Displays a formatted plan summary to the given output stream.
 */
export function displayPlanSummary(
  plan: Plan,
  output?: NodeJS.WritableStream,
): void {
  const out = output ?? process.stdout;
  const write = (s: string) => out.write(s + '\n');

  write('');
  write(chalk.bold('Plan Summary'));
  write(chalk.dim(`  ID: ${plan.id}`));
  write(`  Spec: ${plan.spec.slice(0, 100)}${plan.spec.length > 100 ? '...' : ''}`);
  write(`  Tasks: ${plan.tasks.length}`);
  write('');

  for (const task of plan.tasks) {
    const desc = task.description.length > 80
      ? task.description.slice(0, 80) + '...'
      : task.description;
    const deps = task.dependsOn.length > 0
      ? `, deps: [${task.dependsOn.join(', ')}]`
      : '';
    write(
      `  ${chalk.cyan(`[${task.id}]`)} ${desc} (writes: ${task.writes.length} files, reads: ${task.reads.length} files${deps})`,
    );
  }
  write('');
}
