import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CLI smoke test', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'anvil-cli-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('prints config summary with project name, model, and max workers (CLI-05)', () => {
    const cliPath = join(process.cwd(), 'src', 'cli.ts');
    const output = execSync(`npx tsx "${cliPath}" run "test build"`, {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 15000,
    });
    expect(output).toContain('Project:');
    expect(output).toContain('Model:');
    expect(output).toContain('Max Workers:');
    expect(output).toContain('test build');
  });

  it('creates .anvil/ with expected structure on run (CLUX-04)', async () => {
    const cliPath = join(process.cwd(), 'src', 'cli.ts');
    execSync(`npx tsx "${cliPath}" run "test"`, {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 15000,
    });

    for (const dir of ['logs', 'reports', 'history', 'worktrees']) {
      const s = await stat(join(tmpDir, '.anvil', dir));
      expect(s.isDirectory()).toBe(true);
    }
  });

  it('creates roadmap.json placeholder on run (PLAN-06)', async () => {
    const cliPath = join(process.cwd(), 'src', 'cli.ts');
    execSync(`npx tsx "${cliPath}" run "test"`, {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 15000,
    });
    const content = await readFile(join(tmpDir, '.anvil', 'roadmap.json'), 'utf-8');
    const data = JSON.parse(content);
    expect(data).toHaveProperty('plan');
  });
});
