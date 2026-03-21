import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import simpleGit from 'simple-git';

describe('Rollback integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'anvil-rollback-'));
    const git = simpleGit(tempDir);
    await git.init();
    await git.addConfig('user.email', 'test@anvil.dev');
    await git.addConfig('user.name', 'Test');

    // Create initial file and commit (baseline)
    await writeFile(join(tempDir, 'initial.txt'), 'baseline content');
    await git.add('initial.txt');
    await git.commit('initial commit');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('Test 1: On abort verdict, git HEAD returns to baseline SHA', async () => {
    const git = simpleGit(tempDir);
    const baselineSha = await git.revparse(['HEAD']);

    // Simulate wave execution: add build artifact and commit
    await writeFile(join(tempDir, 'build-artifact.ts'), 'export const x = 1;');
    await git.add('build-artifact.ts');
    await git.commit('feat(anvil): wave 1 task output');

    // HEAD should have moved past baseline
    const postBuildSha = await git.revparse(['HEAD']);
    expect(postBuildSha).not.toBe(baselineSha);

    // Rollback (simulates abort verdict)
    await git.reset(['--hard', baselineSha]);

    const afterRollbackSha = await git.revparse(['HEAD']);
    expect(afterRollbackSha).toBe(baselineSha);
  });

  it('Test 2: On human_required verdict, git HEAD returns to baseline SHA', async () => {
    const git = simpleGit(tempDir);
    const baselineSha = await git.revparse(['HEAD']);

    // Simulate multiple wave commits
    await writeFile(join(tempDir, 'feature-a.ts'), 'export const a = 1;');
    await git.add('feature-a.ts');
    await git.commit('feat(anvil): wave 1');

    await writeFile(join(tempDir, 'feature-b.ts'), 'export const b = 2;');
    await git.add('feature-b.ts');
    await git.commit('feat(anvil): wave 2');

    // Rollback (simulates human_required verdict)
    await git.reset(['--hard', baselineSha]);

    const afterRollbackSha = await git.revparse(['HEAD']);
    expect(afterRollbackSha).toBe(baselineSha);
  });

  it('Test 3: After rollback, build artifacts are not in working tree', async () => {
    const git = simpleGit(tempDir);
    const baselineSha = await git.revparse(['HEAD']);

    // Simulate build artifacts
    await writeFile(join(tempDir, 'build-artifact.ts'), 'export const x = 1;');
    await writeFile(join(tempDir, 'generated.js'), 'console.log("gen");');
    await git.add(['build-artifact.ts', 'generated.js']);
    await git.commit('feat(anvil): build output');

    // Rollback
    await git.reset(['--hard', baselineSha]);

    // Verify artifacts are gone
    await expect(stat(join(tempDir, 'build-artifact.ts'))).rejects.toThrow();
    await expect(stat(join(tempDir, 'generated.js'))).rejects.toThrow();

    // Verify baseline file still exists
    const initialStat = await stat(join(tempDir, 'initial.txt'));
    expect(initialStat.isFile()).toBe(true);
  });
});
