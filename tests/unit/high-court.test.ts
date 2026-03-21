import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import type { Plan } from '../../src/schemas/plan.js';
import type { SubJudgeReport } from '../../src/schemas/reports.js';
import type { AnvilConfig } from '../../src/schemas/config.js';

// ── Mock Agent SDK ───────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

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

/** Helper: configure mockQuery to return an async generator yielding a result with the given JSON data. */
function setQueryResult(data: any) {
  mockQuery.mockReturnValue(
    (async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        result: JSON.stringify(data),
        duration_ms: 100,
        total_cost_usd: 0.01,
        usage: { input_tokens: 500, output_tokens: 200 },
      };
    })(),
  );
}

/** Helper: configure mockQuery to return an empty async generator (no result). */
function setQueryEmpty() {
  mockQuery.mockReturnValue(
    (async function* () {
      // no result message
    })(),
  );
}

// ── runHighCourt tests ──────────────────────────────────────────────────

describe('runHighCourt', () => {
  let tempDir: string;

  beforeEach(async () => {
    mockQuery.mockReset();
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

  it('calls query() from Agent SDK', async () => {
    const report = makeMergeReport();
    setQueryResult(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig());

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.prompt).toBeDefined();
    expect(callArgs.options).toBeDefined();
    expect(callArgs.options.systemPrompt).toBeDefined();
  });

  it('on merge verdict, returns HighCourtReport with verdict="merge"', async () => {
    const report = makeMergeReport();
    setQueryResult(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    const result = await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig());

    expect(result.verdict).toBe('merge');
    expect(result.reasoning).toBe('Architecture is clean and well-structured.');
    expect(result.concerns).toEqual([]);
    expect(result.invariantChecks).toHaveLength(2);
  });

  it('on human_required verdict, returns report with concerns array populated', async () => {
    const report = makeHumanRequiredReport();
    setQueryResult(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    const result = await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig());

    expect(result.verdict).toBe('human_required');
    expect(result.concerns.length).toBeGreaterThan(0);
    expect(result.concerns).toContain('Tight coupling between routes and schemas');
  });

  it('on abort verdict, returns report with concerns and reasoning', async () => {
    const report = makeAbortReport();
    setQueryResult(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    const result = await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig());

    expect(result.verdict).toBe('abort');
    expect(result.concerns.length).toBeGreaterThan(0);
    expect(result.reasoning).toContain('circular dependency');
  });

  it('passes plan spec, Sub-Judge report summaries, and git diff context in prompt', async () => {
    const report = makeMergeReport();
    setQueryResult(report);

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    await runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig());

    const callArgs = mockQuery.mock.calls[0][0];
    const prompt = callArgs.prompt;
    // Should contain plan spec
    expect(prompt).toContain('Build a REST API with user management');
    // Should contain task info
    expect(prompt).toContain('task-001');
    expect(prompt).toContain('task-002');
    // Should contain Sub-Judge info
    expect(prompt).toContain('Wave 1');
    // Should contain git diff context
    expect(prompt).toContain('Diff');
  });

  it('uses config.model for the API call', async () => {
    const report = makeMergeReport();
    setQueryResult(report);
    const config = makeConfig();
    config.model = 'claude-test-model';

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    await runHighCourt(tempDir, makePlan(), makeJudgeReports(), config);

    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.options.model).toBe('claude-test-model');
  });

  it('throws descriptive error if query produces no output', async () => {
    setQueryEmpty();

    const { runHighCourt } = await import('../../src/judges/high-court.js');
    await expect(
      runHighCourt(tempDir, makePlan(), makeJudgeReports(), makeConfig()),
    ).rejects.toThrow(/no.*output|null|failed/i);
  });
});
