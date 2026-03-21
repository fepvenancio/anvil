import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Helper to run the CLI. The `run` command now calls generatePlan which
 * requires an API key. Without one, it will print the config summary
 * and initialize .anvil/ before failing on the API call. These smoke
 * tests verify the setup behavior, so we tolerate the API auth error.
 */
function runCli(args: string, cwd: string): { stdout: string; stderr: string } {
  const cliPath = join(process.cwd(), 'src', 'cli.ts');
  try {
    const stdout = execSync(`npx tsx "${cliPath}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 15000,
    });
    return { stdout, stderr: '' };
  } catch (err: any) {
    // The CLI may exit non-zero due to missing API key after setup.
    // Return whatever output was captured.
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
    const { stdout } = runCli('run "test build"', tmpDir);
    expect(stdout).toContain('Project:');
    expect(stdout).toContain('Model:');
    expect(stdout).toContain('Max Workers:');
    expect(stdout).toContain('test build');
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
});
