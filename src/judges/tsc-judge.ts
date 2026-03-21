import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SubJudgeCheck } from '../schemas/reports.js';

const execFileAsync = promisify(execFile);

export async function runTscCheck(projectDir: string): Promise<SubJudgeCheck> {
  // Check if tsconfig.json exists
  try {
    await stat(join(projectDir, 'tsconfig.json'));
  } catch {
    return { name: 'tsc', passed: true, message: 'skipped: no tsconfig.json' };
  }

  // Check if there are any TypeScript source files to compile
  // tsc errors with TS18003 ("no inputs found") if include paths match no files,
  // which legitimately happens when scaffold-only waves run before source code waves
  try {
    const { stdout } = await execFileAsync('find', [
      projectDir,
      '-maxdepth', '5',
      '-type', 'f',
      '(', '-name', '*.ts', '-o', '-name', '*.tsx', ')',
      '-not', '-path', '*/node_modules/*',
      '-not', '-path', '*/.anvil/*',
    ], { timeout: 5_000 });
    if (stdout.trim().length === 0) {
      return { name: 'tsc', passed: true, message: 'skipped: no .ts files yet' };
    }
  } catch {
    // find failed — proceed with tsc and let it report the real error
  }

  // Ensure dependencies are installed (workers may have created package.json without running npm install)
  try {
    await stat(join(projectDir, 'package.json'));
    await execFileAsync('npm', ['install', '--ignore-scripts'], {
      cwd: projectDir,
      timeout: 120_000,
    });
  } catch {
    // No package.json or install failed — try tsc anyway
  }

  try {
    await execFileAsync('npx', ['tsc', '--noEmit'], {
      cwd: projectDir,
      timeout: 60_000,
    });
    return { name: 'tsc', passed: true };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string };
    return {
      name: 'tsc',
      passed: false,
      message: 'TypeScript compilation failed',
      details: ((err.stdout ?? '') + (err.stderr ?? '')).trim() || 'Unknown error',
    };
  }
}
