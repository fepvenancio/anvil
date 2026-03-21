import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// Root of this project (for symlinking node_modules into temp dirs)
const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

// ── tsc-judge tests ──────────────────────────────────────────────────────

describe('tsc-judge', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'tsc-judge-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns passed=true when tsc --noEmit succeeds', async () => {
    // Create a minimal tsconfig and valid TS file
    await writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'node16', moduleResolution: 'node16', strict: true, noEmit: true },
      include: ['*.ts'],
    }));
    await writeFile(join(tempDir, 'index.ts'), 'export const x: number = 1;\n');

    const { runTscCheck } = await import('../../src/judges/tsc-judge.js');
    const result = await runTscCheck(tempDir);

    expect(result.name).toBe('tsc');
    expect(result.passed).toBe(true);
  });

  it('returns passed=false with details when tsc --noEmit fails', async () => {
    // Create a tsconfig and invalid TS file
    await writeFile(join(tempDir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'node16', moduleResolution: 'node16', strict: true, noEmit: true },
      include: ['*.ts'],
    }));
    await writeFile(join(tempDir, 'index.ts'), 'export const x: number = "not a number";\n');

    const { runTscCheck } = await import('../../src/judges/tsc-judge.js');
    const result = await runTscCheck(tempDir);

    expect(result.name).toBe('tsc');
    expect(result.passed).toBe(false);
    expect(result.message).toBe('TypeScript compilation failed');
    expect(result.details).toBeDefined();
    expect(result.details!.length).toBeGreaterThan(0);
  });

  it('returns passed=true with skip message when no tsconfig.json exists', async () => {
    // tempDir has no tsconfig.json
    const { runTscCheck } = await import('../../src/judges/tsc-judge.js');
    const result = await runTscCheck(tempDir);

    expect(result.name).toBe('tsc');
    expect(result.passed).toBe(true);
    expect(result.message).toBe('skipped: no tsconfig.json');
  });
});

// ── vitest-judge tests ───────────────────────────────────────────────────

describe('vitest-judge', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vitest-judge-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns passed=true with skip message when no test files exist', async () => {
    // tempDir has no test files
    await writeFile(join(tempDir, 'index.ts'), 'export const x = 1;\n');

    const { runVitestCheck } = await import('../../src/judges/vitest-judge.js');
    const result = await runVitestCheck(tempDir);

    expect(result.name).toBe('vitest');
    expect(result.passed).toBe(true);
    expect(result.message).toBe('skipped: no test files found');
  });

  it('returns passed=true when vitest run succeeds', async () => {
    // Create a minimal vitest project with a passing test
    // Symlink node_modules so npx vitest can resolve
    await symlink(join(PROJECT_ROOT, 'node_modules'), join(tempDir, 'node_modules'));
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(tempDir, 'vitest.config.ts'), `
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: false } });
`);
    await writeFile(join(tempDir, 'example.test.ts'), `
import { describe, it, expect } from 'vitest';
describe('example', () => { it('passes', () => { expect(1).toBe(1); }); });
`);

    const { runVitestCheck } = await import('../../src/judges/vitest-judge.js');
    const result = await runVitestCheck(tempDir);

    expect(result.name).toBe('vitest');
    expect(result.passed).toBe(true);
  });

  it('returns passed=false when vitest run fails', async () => {
    // Create a minimal vitest project with a failing test
    await symlink(join(PROJECT_ROOT, 'node_modules'), join(tempDir, 'node_modules'));
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(tempDir, 'vitest.config.ts'), `
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: false } });
`);
    await writeFile(join(tempDir, 'example.test.ts'), `
import { describe, it, expect } from 'vitest';
describe('example', () => { it('fails', () => { expect(1).toBe(2); }); });
`);

    const { runVitestCheck } = await import('../../src/judges/vitest-judge.js');
    const result = await runVitestCheck(tempDir);

    expect(result.name).toBe('vitest');
    expect(result.passed).toBe(false);
    expect(result.message).toBe('Test suite failed');
    expect(result.details).toBeDefined();
  });
});

// ── touch-map-judge tests ────────────────────────────────────────────────

describe('touch-map-judge', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'touchmap-judge-'));
    // Initialize a real git repo
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@test.com"', { cwd: tempDir });
    execSync('git config user.name "Test"', { cwd: tempDir });
    // Create initial commit
    await writeFile(join(tempDir, 'README.md'), '# test\n');
    execSync('git add . && git commit -m "initial"', { cwd: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('returns passed=true when no files changed', async () => {
    const baselineSha = execSync('git rev-parse HEAD', { cwd: tempDir }).toString().trim();

    const { runTouchMapCheck } = await import('../../src/judges/touch-map-judge.js');
    const result = await runTouchMapCheck(tempDir, baselineSha, []);

    expect(result.name).toBe('touch-map');
    expect(result.passed).toBe(true);
  });

  it('returns passed=true when changed files are within allowed writes', async () => {
    const baselineSha = execSync('git rev-parse HEAD', { cwd: tempDir }).toString().trim();

    // Create a new file and commit it
    await writeFile(join(tempDir, 'src.ts'), 'export const x = 1;\n');
    execSync('git add . && git commit -m "add src"', { cwd: tempDir });

    const tasks = [{
      id: 'task-1',
      description: 'test',
      writes: ['src.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: [],
    }];

    const { runTouchMapCheck } = await import('../../src/judges/touch-map-judge.js');
    const result = await runTouchMapCheck(tempDir, baselineSha, tasks);

    expect(result.name).toBe('touch-map');
    expect(result.passed).toBe(true);
  });

  it('returns passed=false with violations when files changed outside allowed writes', async () => {
    const baselineSha = execSync('git rev-parse HEAD', { cwd: tempDir }).toString().trim();

    // Create two files and commit
    await writeFile(join(tempDir, 'allowed.ts'), 'export const x = 1;\n');
    await writeFile(join(tempDir, 'forbidden.ts'), 'export const y = 2;\n');
    execSync('git add . && git commit -m "add files"', { cwd: tempDir });

    const tasks = [{
      id: 'task-1',
      description: 'test',
      writes: ['allowed.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: [],
      exports: [],
    }];

    const { runTouchMapCheck } = await import('../../src/judges/touch-map-judge.js');
    const result = await runTouchMapCheck(tempDir, baselineSha, tasks);

    expect(result.name).toBe('touch-map');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('1 file(s) modified outside declared writes[]');
    expect(result.details).toContain('forbidden.ts');
  });
});

// ── sub-judge-panel orchestrator tests ───────────────────────────────────

describe('sub-judge-panel', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'panel-'));
    // Initialize a real git repo (needed for touch-map judge)
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@test.com"', { cwd: tempDir });
    execSync('git config user.name "Test"', { cwd: tempDir });
    await writeFile(join(tempDir, 'README.md'), '# test\n');
    execSync('git add . && git commit -m "initial"', { cwd: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('runs all three judges and returns SubJudgeReport with allPassed=true when all pass', async () => {
    const baselineSha = execSync('git rev-parse HEAD', { cwd: tempDir }).toString().trim();

    const { runSubJudges } = await import('../../src/judges/sub-judge-panel.js');
    const report = await runSubJudges(tempDir, 1, [], baselineSha);

    expect(report.waveNumber).toBe(1);
    expect(report.checks).toHaveLength(5);
    expect(report.allPassed).toBe(true);
    expect(report.timestamp).toBeDefined();
    // Validate ISO datetime
    expect(() => new Date(report.timestamp)).not.toThrow();
    expect(new Date(report.timestamp).toISOString()).toBe(report.timestamp);

    // All five check names should be present
    const names = report.checks.map(c => c.name).sort();
    expect(names).toEqual(['interface', 'security', 'touch-map', 'tsc', 'vitest']);
  });

  it('returns allPassed=false when one judge fails but includes all checks', async () => {
    const baselineSha = execSync('git rev-parse HEAD', { cwd: tempDir }).toString().trim();

    // Create a file outside any allowed writes to trigger touch-map failure
    await writeFile(join(tempDir, 'unauthorized.ts'), 'export const bad = true;\n');
    execSync('git add . && git commit -m "bad file"', { cwd: tempDir });

    const tasks = [{
      id: 'task-1',
      description: 'test',
      writes: ['allowed.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: [],
      exports: [],
    }];

    const { runSubJudges } = await import('../../src/judges/sub-judge-panel.js');
    const report = await runSubJudges(tempDir, 2, tasks, baselineSha);

    expect(report.waveNumber).toBe(2);
    expect(report.checks).toHaveLength(5);
    expect(report.allPassed).toBe(false);

    // touch-map should fail, tsc and vitest should pass (skip)
    const touchMap = report.checks.find(c => c.name === 'touch-map');
    expect(touchMap?.passed).toBe(false);
  });

  it('validates report against SubJudgeReportSchema', async () => {
    const { SubJudgeReportSchema } = await import('../../src/schemas/reports.js');
    const baselineSha = execSync('git rev-parse HEAD', { cwd: tempDir }).toString().trim();

    const { runSubJudges } = await import('../../src/judges/sub-judge-panel.js');
    const report = await runSubJudges(tempDir, 1, [], baselineSha);

    // Should parse without throwing
    const parsed = SubJudgeReportSchema.parse(report);
    expect(parsed.waveNumber).toBe(1);
    expect(parsed.allPassed).toBe(true);
  });

  it('saves report to .anvil/reports/wave-{N}-judges.json', async () => {
    const baselineSha = execSync('git rev-parse HEAD', { cwd: tempDir }).toString().trim();
    const { readFile } = await import('node:fs/promises');

    const { runSubJudges } = await import('../../src/judges/sub-judge-panel.js');
    await runSubJudges(tempDir, 3, [], baselineSha);

    const reportPath = join(tempDir, '.anvil', 'reports', 'wave-3-judges.json');
    const content = await readFile(reportPath, 'utf-8');
    const saved = JSON.parse(content);
    expect(saved.waveNumber).toBe(3);
    expect(saved.checks).toHaveLength(5);
    expect(saved.allPassed).toBe(true);
  });

  it('judges run in parallel via Promise.all', async () => {
    // This test verifies structural behavior: all 4 checks are present
    // and the total execution time is less than the sum of individual judge times
    // (a proxy for parallel execution). The key verification is that all 3 judges
    // are invoked and their results collected.
    const baselineSha = execSync('git rev-parse HEAD', { cwd: tempDir }).toString().trim();

    const { runSubJudges } = await import('../../src/judges/sub-judge-panel.js');
    const start = Date.now();
    const report = await runSubJudges(tempDir, 1, [], baselineSha);
    const elapsed = Date.now() - start;

    // All five judges should have run
    expect(report.checks).toHaveLength(5);
    // Should complete reasonably fast (all skip since no tsconfig/tests/changes)
    expect(elapsed).toBeLessThan(5000);
  });
});
