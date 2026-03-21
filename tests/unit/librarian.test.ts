import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LIBRARIAN_SYSTEM_PROMPT } from '../../src/prompts/librarian-system.js';
import type { Plan } from '../../src/schemas/plan.js';
import type { HighCourtReport } from '../../src/schemas/reports.js';
import type { AnvilConfig } from '../../src/schemas/config.js';

// ── Mock Agent SDK ───────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

/**
 * Helper: configure mockQuery to return different text results on successive calls.
 * The librarian calls query() twice — once for README, once for ARCHITECTURE.
 */
function setQueryTexts(readmeText = '# Mock README', archText = '# Mock Architecture') {
  let callIndex = 0;
  const texts = [readmeText, archText];
  mockQuery.mockImplementation(() =>
    (async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        result: texts[callIndex++],
        duration_ms: 100,
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    })(),
  );
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
    mockQuery.mockReset();
    tempDir = await mkdtemp(join(tmpdir(), 'librarian-test-'));
    // Create minimal project structure
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project', version: '1.0.0' }));
    await mkdir(join(tempDir, 'src'), { recursive: true });
    await writeFile(join(tempDir, 'src', 'index.ts'), 'console.log("hello");');
  });

  it('calls query() twice (once for README, once for ARCHITECTURE)', async () => {
    setQueryTexts();
    const { runLibrarian } = await import('../../src/stations/librarian.js');
    await runLibrarian(tempDir, plan, report, config);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('writes README.md to projectDir root', async () => {
    setQueryTexts();
    const { runLibrarian } = await import('../../src/stations/librarian.js');
    await runLibrarian(tempDir, plan, report, config);
    const content = await readFile(join(tempDir, 'README.md'), 'utf-8');
    expect(content).toBeTruthy();
  });

  it('writes ARCHITECTURE.md to projectDir root', async () => {
    setQueryTexts();
    const { runLibrarian } = await import('../../src/stations/librarian.js');
    await runLibrarian(tempDir, plan, report, config);
    const content = await readFile(join(tempDir, 'ARCHITECTURE.md'), 'utf-8');
    expect(content).toBeTruthy();
  });

  it('README.md content comes from LLM response text', async () => {
    setQueryTexts('# Custom README Content', '# Arch');
    const { runLibrarian } = await import('../../src/stations/librarian.js');
    await runLibrarian(tempDir, plan, report, config);
    const content = await readFile(join(tempDir, 'README.md'), 'utf-8');
    expect(content).toBe('# Custom README Content');
  });

  it('ARCHITECTURE.md content comes from LLM response text', async () => {
    setQueryTexts('# Mock', '# Custom Architecture Content');
    const { runLibrarian } = await import('../../src/stations/librarian.js');
    await runLibrarian(tempDir, plan, report, config);
    const content = await readFile(join(tempDir, 'ARCHITECTURE.md'), 'utf-8');
    expect(content).toBe('# Custom Architecture Content');
  });

  it('returns { readmePath, architecturePath } with absolute paths', async () => {
    setQueryTexts();
    const { runLibrarian } = await import('../../src/stations/librarian.js');
    const result = await runLibrarian(tempDir, plan, report, config);
    expect(result.readmePath).toBe(join(tempDir, 'README.md'));
    expect(result.architecturePath).toBe(join(tempDir, 'ARCHITECTURE.md'));
  });

  it('works without error', async () => {
    setQueryTexts();
    const { runLibrarian } = await import('../../src/stations/librarian.js');
    const result = await runLibrarian(tempDir, plan, report, config);
    expect(result.readmePath).toBeTruthy();
    expect(result.architecturePath).toBeTruthy();
  });
});
