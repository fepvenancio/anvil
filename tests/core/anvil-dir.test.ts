import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initAnvilDir } from '../../src/core/anvil-dir.js';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('initAnvilDir', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'anvil-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .anvil directory with all subdirectories', async () => {
    await initAnvilDir(tmpDir);
    for (const dir of ['logs', 'reports', 'history', 'worktrees']) {
      const s = await stat(join(tmpDir, '.anvil', dir));
      expect(s.isDirectory()).toBe(true);
    }
  });

  it('creates roadmap.json with null plan', async () => {
    await initAnvilDir(tmpDir);
    const content = await readFile(join(tmpDir, '.anvil', 'roadmap.json'), 'utf-8');
    expect(JSON.parse(content)).toEqual({ plan: null });
  });

  it('is idempotent — second call does not overwrite roadmap.json', async () => {
    await initAnvilDir(tmpDir);
    const roadmapPath = join(tmpDir, '.anvil', 'roadmap.json');
    const { writeFile: wf } = await import('node:fs/promises');
    await wf(roadmapPath, JSON.stringify({ plan: { id: 'test' } }));
    await initAnvilDir(tmpDir);
    const content = await readFile(roadmapPath, 'utf-8');
    expect(JSON.parse(content)).toEqual({ plan: { id: 'test' } });
  });

  it('returns the .anvil directory path', async () => {
    const result = await initAnvilDir(tmpDir);
    expect(result).toBe(join(tmpDir, '.anvil'));
  });
});
