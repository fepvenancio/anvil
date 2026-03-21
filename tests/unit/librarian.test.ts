import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LIBRARIAN_SYSTEM_PROMPT } from '../../src/prompts/librarian-system.js';
import { runLibrarian } from '../../src/stations/librarian.js';
import type { Plan } from '../../src/schemas/plan.js';
import type { HighCourtReport } from '../../src/schemas/reports.js';
import type { AnvilConfig } from '../../src/schemas/config.js';

function mockClient(readmeText = '# Mock README', archText = '# Mock Architecture') {
  const responses = [
    {
      content: [{ type: 'text', text: readmeText }],
      usage: { input_tokens: 100, output_tokens: 200 },
    },
    {
      content: [{ type: 'text', text: archText }],
      usage: { input_tokens: 150, output_tokens: 250 },
    },
  ];
  let callIndex = 0;
  return {
    messages: {
      create: vi.fn().mockImplementation(() => {
        return Promise.resolve(responses[callIndex++]);
      }),
    },
  } as any;
}

const plan: Plan = {
  id: 'plan-001',
  spec: 'Build a todo app',
  tasks: [
    {
      id: 'task-001',
      description: 'Create todo model',
      writes: ['src/model.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: ['model exists'],
    },
  ],
  createdAt: '2026-03-20T00:00:00Z',
};

const report: HighCourtReport = {
  verdict: 'merge',
  reasoning: 'All looks good',
  concerns: [],
  invariantChecks: [{ name: 'no-circular-deps', passed: true }],
  timestamp: '2026-03-20T01:00:00Z',
};

const config: AnvilConfig = {
  projectName: 'test-project',
  model: 'claude-sonnet-4-6',
  maxWorkers: 4,
  anvilDir: '.anvil',
};

describe('LIBRARIAN_SYSTEM_PROMPT', () => {
  it('is a non-empty string mentioning README and ARCHITECTURE', () => {
    expect(typeof LIBRARIAN_SYSTEM_PROMPT).toBe('string');
    expect(LIBRARIAN_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    expect(LIBRARIAN_SYSTEM_PROMPT).toMatch(/README/i);
    expect(LIBRARIAN_SYSTEM_PROMPT).toMatch(/ARCHITECTURE/i);
  });
});

describe('runLibrarian', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'librarian-test-'));
    // Create minimal project structure
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project', version: '1.0.0' }));
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'index.ts'), 'console.log("hello");');
  });

  it('calls client.messages.create() twice (once for README, once for ARCHITECTURE)', async () => {
    const client = mockClient();
    await runLibrarian(tempDir, plan, report, config, { client });
    expect(client.messages.create).toHaveBeenCalledTimes(2);
  });

  it('writes README.md to projectDir root', async () => {
    const client = mockClient();
    await runLibrarian(tempDir, plan, report, config, { client });
    const content = await readFile(join(tempDir, 'README.md'), 'utf-8');
    expect(content).toBeTruthy();
  });

  it('writes ARCHITECTURE.md to projectDir root', async () => {
    const client = mockClient();
    await runLibrarian(tempDir, plan, report, config, { client });
    const content = await readFile(join(tempDir, 'ARCHITECTURE.md'), 'utf-8');
    expect(content).toBeTruthy();
  });

  it('README.md content comes from LLM response text blocks', async () => {
    const client = mockClient('# Custom README Content');
    await runLibrarian(tempDir, plan, report, config, { client });
    const content = await readFile(join(tempDir, 'README.md'), 'utf-8');
    expect(content).toBe('# Custom README Content');
  });

  it('ARCHITECTURE.md content comes from LLM response text blocks', async () => {
    const client = mockClient('# Mock', '# Custom Architecture Content');
    await runLibrarian(tempDir, plan, report, config, { client });
    const content = await readFile(join(tempDir, 'ARCHITECTURE.md'), 'utf-8');
    expect(content).toBe('# Custom Architecture Content');
  });

  it('returns { readmePath, architecturePath } with absolute paths', async () => {
    const client = mockClient();
    const result = await runLibrarian(tempDir, plan, report, config, { client });
    expect(result.readmePath).toBe(join(tempDir, 'README.md'));
    expect(result.architecturePath).toBe(join(tempDir, 'ARCHITECTURE.md'));
  });

  it('calls costTracker.recordFromResponse twice when provided', async () => {
    const client = mockClient();
    const costTracker = { recordFromResponse: vi.fn() };
    await runLibrarian(tempDir, plan, report, config, { client, costTracker });
    expect(costTracker.recordFromResponse).toHaveBeenCalledTimes(2);
    // Verify agent name and model
    expect(costTracker.recordFromResponse).toHaveBeenCalledWith(
      expect.objectContaining({ usage: expect.any(Object) }),
      'librarian',
      config.model,
    );
  });

  it('works without error when costTracker is omitted', async () => {
    const client = mockClient();
    // Should not throw
    const result = await runLibrarian(tempDir, plan, report, config, { client });
    expect(result.readmePath).toBeTruthy();
    expect(result.architecturePath).toBeTruthy();
  });
});
