import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import type { Plan } from '../../src/schemas/plan.js';
import type { SubJudgeReport } from '../../src/schemas/reports.js';
import type { AnvilConfig } from '../../src/schemas/config.js';

// ── System prompt tests ─────────────────────────────────────────────────

describe('high-court system prompt', () => {
  it('exports HIGH_COURT_SYSTEM_PROMPT as a non-empty string', async () => {
    const { HIGH_COURT_SYSTEM_PROMPT } = await import('../../src/prompts/high-court-system.js');
    expect(typeof HIGH_COURT_SYSTEM_PROMPT).toBe('string');
    expect(HIGH_COURT_SYSTEM_PROMPT.length).toBeGreaterThan(200);
  });

  it('contains "architectural review" or "architecture"', async () => {
    const { HIGH_COURT_SYSTEM_PROMPT } = await import('../../src/prompts/high-court-system.js');
    const lower = HIGH_COURT_SYSTEM_PROMPT.toLowerCase();
    expect(lower.includes('architectural review') || lower.includes('architecture')).toBe(true);
  });

  it('mentions all three verdict options: merge, human_required, abort', async () => {
    const { HIGH_COURT_SYSTEM_PROMPT } = await import('../../src/prompts/high-court-system.js');
    expect(HIGH_COURT_SYSTEM_PROMPT).toContain('merge');
    expect(HIGH_COURT_SYSTEM_PROMPT).toContain('human_required');
    expect(HIGH_COURT_SYSTEM_PROMPT).toContain('abort');
  });

  it('instructs checking for circular dependencies', async () => {
    const { HIGH_COURT_SYSTEM_PROMPT } = await import('../../src/prompts/high-court-system.js');
    const lower = HIGH_COURT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('circular');
  });

  it('instructs checking cross-task coherence', async () => {
    const { HIGH_COURT_SYSTEM_PROMPT } = await import('../../src/prompts/high-court-system.js');
    const lower = HIGH_COURT_SYSTEM_PROMPT.toLowerCase();
    expect(lower.includes('cross-task') || lower.includes('coherence')).toBe(true);
  });
});

// ── Fixtures ────────────────────────────────────────────────────────────

const makePlan = (): Plan => ({
  id: 'plan-001',
  spec: 'Build a REST API with user management',
  tasks: [
    {
      id: 'task-001',
      description: 'Create user schema',
      writes: ['src/schemas/user.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: ['Schema exports User type'],
    },
    {
      id: 'task-002',
      description: 'Create user routes',
      writes: ['src/routes/users.ts'],
      reads: ['src/schemas/user.ts'],
      dependsOn: ['task-001'],
      acceptanceCriteria: ['GET /users returns 200'],
    },
  ],
  createdAt: '2026-03-20T00:00:00Z',
});

const makeConfig = (): AnvilConfig => ({
  projectName: 'test-project',
  model: 'claude-sonnet-4-6',
  maxWorkers: 4,
  anvilDir: '.anvil',
});

const makeJudgeReports = (): SubJudgeReport[] => [
  {
    waveNumber: 1,
    checks: [
      { name: 'tsc', passed: true },
      { name: 'vitest', passed: true },
      { name: 'touch-map', passed: true },
    ],
    allPassed: true,
    timestamp: '2026-03-20T01:00:00Z',
  },
];

const makeMergeReport = () => ({
  verdict: 'merge' as const,
  reasoning: 'Architecture is clean and well-structured.',
  concerns: [],
  invariantChecks: [
    { name: 'no-circular-deps', passed: true },
    { name: 'consistent-error-handling', passed: true },
  ],
  timestamp: new Date().toISOString(),
});

const makeHumanRequiredReport = () => ({
  verdict: 'human_required' as const,
  reasoning: 'Some design concerns need human review.',
  concerns: ['Tight coupling between routes and schemas', 'Missing error boundaries'],
  invariantChecks: [
    { name: 'no-circular-deps', passed: true },
    { name: 'consistent-error-handling', passed: false, detail: 'Inconsistent try/catch usage' },
  ],
  timestamp: new Date().toISOString(),
});

const makeAbortReport = () => ({
  verdict: 'abort' as const,
  reasoning: 'Critical circular dependency makes the build unsafe.',
  concerns: ['Circular dependency between auth and user modules', 'No error handling in data layer'],
  invariantChecks: [
    { name: 'no-circular-deps', passed: false, detail: 'auth.ts <-> user.ts cycle' },
    { name: 'consistent-error-handling', passed: false },
  ],
  timestamp: new Date().toISOString(),
});

const makeMockClient = (parsedOutput: any) => ({
  messages: {
    parse: vi.fn().mockResolvedValue({
      parsed_output: parsedOutput,
      usage: { input_tokens: 500, output_tokens: 200 },
    }),
  },
});

// ── runHighCourt tests ──────────────────────────────────────────────────

describe('runHighCourt', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'high-court-'));
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@test.com"', { cwd: tempDir });
    execSync('git config user.name "Test"', { cwd: tempDir });
    // Initial commit
    execSync('echo "# test" > README.md && git add . && git commit -m "initial"', { cwd: tempDir });
    // Second commit so HEAD~1 diff works
    execSync('echo "const x = 1;" > index.ts && git add . && git commit -m "add code"', { cwd: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('calls client.messages.parse() with zodOutputFormat(HighCourtReportSchema)', async () => {
    const report = makeMergeReport();
    const mockClient = makeMockClient(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig(), {
      client: mockClient as any,
    });

    expect(mockClient.messages.parse).toHaveBeenCalledTimes(1);
    const callArgs = mockClient.messages.parse.mock.calls[0][0];
    expect(callArgs.output_config).toBeDefined();
    expect(callArgs.output_config.format).toBeDefined();
  });

  it('on merge verdict, returns HighCourtReport with verdict="merge"', async () => {
    const report = makeMergeReport();
    const mockClient = makeMockClient(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    const result = await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig(), {
      client: mockClient as any,
    });

    expect(result.verdict).toBe('merge');
    expect(result.reasoning).toBe('Architecture is clean and well-structured.');
    expect(result.concerns).toEqual([]);
    expect(result.invariantChecks).toHaveLength(2);
  });

  it('on human_required verdict, returns report with concerns array populated', async () => {
    const report = makeHumanRequiredReport();
    const mockClient = makeMockClient(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    const result = await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig(), {
      client: mockClient as any,
    });

    expect(result.verdict).toBe('human_required');
    expect(result.concerns.length).toBeGreaterThan(0);
    expect(result.concerns).toContain('Tight coupling between routes and schemas');
  });

  it('on abort verdict, returns report with concerns and reasoning', async () => {
    const report = makeAbortReport();
    const mockClient = makeMockClient(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    const result = await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig(), {
      client: mockClient as any,
    });

    expect(result.verdict).toBe('abort');
    expect(result.concerns.length).toBeGreaterThan(0);
    expect(result.reasoning).toContain('circular dependency');
  });

  it('passes plan spec, Sub-Judge report summaries, and git diff context in user message', async () => {
    const report = makeMergeReport();
    const mockClient = makeMockClient(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig(), {
      client: mockClient as any,
    });

    const callArgs = mockClient.messages.parse.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;
    // Should contain plan spec
    expect(userMessage).toContain('Build a REST API with user management');
    // Should contain task info
    expect(userMessage).toContain('task-001');
    expect(userMessage).toContain('task-002');
    // Should contain Sub-Judge info
    expect(userMessage).toContain('Wave 1');
    // Should contain git diff context
    expect(userMessage).toContain('Diff');
  });

  it('uses config.model for the API call', async () => {
    const report = makeMergeReport();
    const mockClient = makeMockClient(report);
    const config = makeConfig();
    config.model = 'claude-test-model';

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    await runHighCourt(tempDir, makePlan(), makeJudgeReports(), config, {
      client: mockClient as any,
    });

    const callArgs = mockClient.messages.parse.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-test-model');
  });

  it('response timestamp is a valid ISO datetime string', async () => {
    const report = makeMergeReport();
    const mockClient = makeMockClient(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    const result = await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig(), {
      client: mockClient as any,
    });

    expect(result.timestamp).toBeDefined();
    const date = new Date(result.timestamp);
    expect(date.toISOString()).toBe(result.timestamp);
  });

  it('throws descriptive error if parsed_output is null', async () => {
    const mockClient = makeMockClient(null);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    await expect(
      runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig(), {
        client: mockClient as any,
      }),
    ).rejects.toThrow(/no.*output|null|failed/i);
  });

  it('when options.costTracker is provided, recordFromResponse is called', async () => {
    const report = makeMergeReport();
    const mockClient = makeMockClient(report);
    const costTracker = { recordFromResponse: vi.fn() };

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig(), {
      client: mockClient as any,
      costTracker: costTracker as any,
    });

    expect(costTracker.recordFromResponse).toHaveBeenCalledTimes(1);
    expect(costTracker.recordFromResponse).toHaveBeenCalledWith(
      expect.objectContaining({ parsed_output: report, usage: { input_tokens: 500, output_tokens: 200 } }),
      'high-court',
      'claude-sonnet-4-6',
    );
  });

  it('when options.costTracker is omitted, function still works without error', async () => {
    const report = makeMergeReport();
    const mockClient = makeMockClient(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    const result = await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig(), {
      client: mockClient as any,
      // No costTracker
    });

    expect(result.verdict).toBe('merge');
  });
});
