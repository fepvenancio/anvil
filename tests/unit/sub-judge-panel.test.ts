import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

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
    }];

    const { runTouchMapCheck } = await import('../../src/judges/touch-map-judge.js');
    const result = await runTouchMapCheck(tempDir, baselineSha, tasks);

    expect(result.name).toBe('touch-map');
    expect(result.passed).toBe(false);
    expect(result.message).toContain('1 file(s) modified outside declared writes[]');
    expect(result.details).toContain('forbidden.ts');
  });
});
