import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Helper to run the CLI. Without ANTHROPIC_API_KEY, the CLI prints
 * config summary, initializes .anvil/, then exits with an error message.
 * These smoke tests verify the setup behavior before the API call.
 */
function runCli(args: string, cwd: string): { stdout: string; stderr: string } {
  const cliPath = join(process.cwd(), 'src', 'cli.ts');
  try {
    const stdout = execSync(`npx tsx "${cliPath}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 10000,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    return { stdout, stderr: '' };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

describe('CLI smoke test', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'anvil-cli-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('prints config summary with project name, model, and max workers (CLI-05)', () => {
    const { stdout, stderr } = runCli('run "test build"', tmpDir);
    const output = stdout + stderr;
    expect(output).toContain('Project:');
    expect(output).toContain('Model:');
    expect(output).toContain('Max Workers:');
  });

  it('creates .anvil/ with expected structure on run (CLUX-04)', async () => {
    runCli('run "test"', tmpDir);

    for (const dir of ['logs', 'reports', 'history', 'worktrees']) {
      const s = await stat(join(tmpDir, '.anvil', dir));
      expect(s.isDirectory()).toBe(true);
    }
  });

  it('creates roadmap.json placeholder on run (PLAN-06)', async () => {
    runCli('run "test"', tmpDir);
    const content = await readFile(join(tmpDir, '.anvil', 'roadmap.json'), 'utf-8');
    const data = JSON.parse(content);
    expect(data).toHaveProperty('plan');
  });

  it('shows version with --version flag', () => {
    const cliPath = join(process.cwd(), 'src', 'cli.ts');
    const stdout = require('node:child_process').execSync(
      `npx tsx "${cliPath}" --version`,
      { encoding: 'utf-8', timeout: 5000 },
    );
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
