import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import simpleGit from 'simple-git';
import { vi } from 'vitest';
import { runLibrarian } from '../../src/stations/librarian.js';
import type { Plan } from '../../src/schemas/plan.js';
import type { HighCourtReport } from '../../src/schemas/reports.js';
import type { AnvilConfig } from '../../src/schemas/config.js';

const MOCK_README = '# My Project\n\nA test project built with Anvil.';
const MOCK_ARCH = '# Architecture\n\n## Overview\n\nLayered architecture with clear module boundaries.';

function mockClient() {
  const responses = [
    {
      content: [{ type: 'text', text: MOCK_README }],
      usage: { input_tokens: 100, output_tokens: 200 },
    },
    {
      content: [{ type: 'text', text: MOCK_ARCH }],
      usage: { input_tokens: 150, output_tokens: 250 },
    },
  ];
  let callIndex = 0;
  return {
    messages: {
      create: vi.fn().mockImplementation(() => Promise.resolve(responses[callIndex++])),
    },
  } as any;
}

const plan: Plan = {
  id: 'plan-int-001',
  spec: 'Build a simple web server',
  tasks: [
    {
      id: 'task-001',
      description: 'Create server entry point',
      writes: ['src/server.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: ['server starts'],
    },
  ],
  createdAt: '2026-03-20T00:00:00Z',
};

const report: HighCourtReport = {
  verdict: 'merge',
  reasoning: 'Clean implementation, well-structured code.',
  concerns: [],
  invariantChecks: [
    { name: 'no-circular-deps', passed: true },
    { name: 'consistent-error-handling', passed: true },
  ],
  timestamp: '2026-03-20T01:00:00Z',
};

const config: AnvilConfig = {
  projectName: 'integration-test-project',
  model: 'claude-sonnet-4-20250514',
  maxWorkers: 4,
  anvilDir: '.anvil',
};

describe('Librarian atomic commit integration', { timeout: 15000 }, () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'librarian-int-'));
    const git = simpleGit(tempDir);
    await git.init();
    await git.raw(['config', 'user.email', 'test@anvil.dev']);
    await git.raw(['config', 'user.name', 'Anvil Test']);
    // Create initial commit so git log works
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }));
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'server.ts'), 'export const start = () => {};');
    await git.add('.');
    await git.commit('initial commit');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('README.md and ARCHITECTURE.md exist on disk after runLibrarian', async () => {
    const client = mockClient();
    await runLibrarian(tempDir, plan, report, config, { client });

    const readme = await readFile(join(tempDir, 'README.md'), 'utf-8');
    const arch = await readFile(join(tempDir, 'ARCHITECTURE.md'), 'utf-8');

    expect(readme).toBe(MOCK_README);
    expect(arch).toBe(MOCK_ARCH);
  });

  it('generated docs can be committed as atomic git commits', async () => {
    const client = mockClient();
    await runLibrarian(tempDir, plan, report, config, { client });

    const git = simpleGit(tempDir);
    await git.add(['README.md', 'ARCHITECTURE.md']);
    await git.commit('docs(anvil): generate README and ARCHITECTURE');

    const log = await git.log();
    expect(log.all.length).toBe(2); // initial + docs commit
    expect(log.latest!.message).toBe('docs(anvil): generate README and ARCHITECTURE');
  });

  it('git log shows the doc commit with descriptive message', async () => {
    const client = mockClient();
    await runLibrarian(tempDir, plan, report, config, { client });

    const git = simpleGit(tempDir);
    await git.add(['README.md', 'ARCHITECTURE.md']);
    await git.commit('docs(anvil): generate README and ARCHITECTURE');

    const log = await git.log();
    const docCommit = log.all.find((c) => c.message.includes('docs(anvil)'));
    expect(docCommit).toBeDefined();

    // Verify the committed content matches what was written
    const show = await git.show([`${docCommit!.hash}:README.md`]);
    expect(show).toBe(MOCK_README);

    const showArch = await git.show([`${docCommit!.hash}:ARCHITECTURE.md`]);
    expect(showArch).toBe(MOCK_ARCH);
  });
});
