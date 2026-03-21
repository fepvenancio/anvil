import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import simpleGit from 'simple-git';
import { validateTouchMap } from '../../src/git/worktree-manager.js';

describe('validateTouchMap', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'anvil-touchmap-'));
    const git = simpleGit(tempDir);
    await git.init();
    await git.raw(['config', 'user.email', 'test@anvil.dev']);
    await git.raw(['config', 'user.name', 'Anvil Test']);
    // Create an initial commit so HEAD exists
    await writeFile(join(tempDir, '.gitkeep'), '');
    await git.add('.');
    await git.commit('initial commit');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('allows changes to declared files', async () => {
    await writeFile(join(tempDir, 'allowed.ts'), 'export const x = 1;');
    const result = await validateTouchMap(tempDir, ['allowed.ts']);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('rejects changes to undeclared files', async () => {
    await writeFile(join(tempDir, 'sneaky.ts'), 'export const x = 1;');
    const result = await validateTouchMap(tempDir, ['allowed.ts']);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('sneaky.ts');
  });

  it('detects new untracked files outside writes', async () => {
    await writeFile(join(tempDir, 'rogue.ts'), 'console.log("rogue");');
    const result = await validateTouchMap(tempDir, ['legit.ts']);
    expect(result.valid).toBe(false);
    expect(result.violations).toContain('rogue.ts');
  });

  it('allows multiple declared files', async () => {
    await writeFile(join(tempDir, 'a.ts'), 'export const a = 1;');
    await writeFile(join(tempDir, 'b.ts'), 'export const b = 2;');
    await writeFile(join(tempDir, 'c.ts'), 'export const c = 3;');
    const result = await validateTouchMap(tempDir, ['a.ts', 'b.ts', 'c.ts']);
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });
});
