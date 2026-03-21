import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SubJudgeCheck } from '../schemas/reports.js';

const execFileAsync = promisify(execFile);

async function hasTestFiles(projectDir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('find', [
      projectDir,
      '-maxdepth', '5',
      '-type', 'f',
      '(', '-name', '*.test.ts', '-o', '-name', '*.test.tsx',
      '-o', '-name', '*.spec.ts', '-o', '-name', '*.spec.tsx',
      '-o', '-name', '*.test.js', '-o', '-name', '*.test.jsx',
      '-o', '-name', '*.spec.js', '-o', '-name', '*.spec.jsx', ')',
      '-not', '-path', '*/node_modules/*',
    ], { timeout: 5_000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function runVitestCheck(projectDir: string): Promise<SubJudgeCheck> {
  const testFilesExist = await hasTestFiles(projectDir);
  if (!testFilesExist) {
    return { name: 'vitest', passed: true, message: 'skipped: no test files found' };
  }

  try {
    await execFileAsync('npx', ['vitest', 'run'], {
      cwd: projectDir,
      timeout: 120_000,
    });
    return { name: 'vitest', passed: true };
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string };
    return {
      name: 'vitest',
      passed: false,
      message: 'Test suite failed',
      details: ((err.stdout ?? '') + (err.stderr ?? '')).trim() || 'Unknown error',
    };
  }
}
