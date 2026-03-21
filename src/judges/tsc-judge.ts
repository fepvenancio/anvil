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
