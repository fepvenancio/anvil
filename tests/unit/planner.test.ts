import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnvilConfig } from '../../src/schemas/config.js';
import type { Plan } from '../../src/schemas/plan.js';

// Mock the Agent SDK at module level
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

const config: AnvilConfig = {
  projectName: 'test-project',
  model: 'claude-sonnet-4-6',
  maxWorkers: 4,
  anvilDir: '.anvil',
};

function makePlan(overrides?: Partial<Plan>): Plan {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    spec: 'Build a REST API',
    createdAt: '2026-01-01T00:00:00Z',
    tasks: [
      {
        id: 'task-001',
        description: 'Scaffold the project with package.json and tsconfig.json',
        writes: ['package.json', 'tsconfig.json'],
        reads: [],
        dependsOn: [],
        acceptanceCriteria: ['npm install succeeds'],
        exports: [],
      },
      {
        id: 'task-002',
        description: 'Create user routes',
        writes: ['src/routes/users.ts'],
        reads: [],
        dependsOn: ['task-001'],
        acceptanceCriteria: ['GET /users returns 200'],
        exports: [{ name: 'usersRouter', type: 'Router' }],
      },
    ],
    ...overrides,
  };
}

function makeOverlappingPlan(): Plan {
  return {
    id: 'plan-overlap',
    spec: 'Build something',
    createdAt: '2026-01-01T00:00:00Z',
    tasks: [
      {
        id: 'task-001',
        description: 'Task A',
        writes: ['src/index.ts'],
        reads: [],
        dependsOn: [],
        acceptanceCriteria: [],
      },
      {
        id: 'task-002',
        description: 'Task B',
        writes: ['src/index.ts'],
        reads: [],
        dependsOn: [],
        acceptanceCriteria: [],
      },
    ],
  };
}

/** Helper: configure mockQuery to return an async generator yielding a result with the given data. */
function setQueryResult(data: any) {
  mockQuery.mockReturnValue(
    (async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        result: JSON.stringify(data),
        duration_ms: 100,
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    })(),
  );
}

/** Helper: configure mockQuery to return different results on successive calls. */
function setQueryResults(...dataItems: any[]) {
  let callIndex = 0;
  mockQuery.mockImplementation(() =>
    (async function* () {
      const data = dataItems[callIndex++];
      yield {
        type: 'result',
        subtype: 'success',
        result: JSON.stringify(data),
        duration_ms: 100,
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 200 },
      };
    })(),
  );
}

/** Helper: configure mockQuery to return an async generator with no result message. */
function setQueryEmpty() {
  mockQuery.mockReturnValue(
    (async function* () {
      // yield nothing — no result message
    })(),
  );
}

describe('generatePlan', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('generates a valid plan from spec', async () => {
    const plan = makePlan();
    setQueryResult(plan);

    const { generatePlan } = await import('../../src/stations/planner.js');
    const result = await generatePlan('Build a REST API', config);

    expect(result.id).toBe(plan.id);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].writes).toContain('package.json');
    expect(result.tasks[1].dependsOn).toContain('task-001');
    expect(mockQuery).toHaveBeenCalledOnce();
  });

  it('retries on write overlap then succeeds', async () => {
    const overlapping = makeOverlappingPlan();
    const clean = makePlan();
    setQueryResults(overlapping, clean);

    const { generatePlan } = await import('../../src/stations/planner.js');
    const result = await generatePlan('Build something', config);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(result.id).toBe(clean.id);
  });

  it('throws after max retries on persistent overlap', async () => {
    const overlapping = makeOverlappingPlan();
    // Return overlapping plan every time
    mockQuery.mockImplementation(() =>
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: JSON.stringify(overlapping),
          duration_ms: 100,
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 200 },
        };
      })(),
    );

    const { generatePlan } = await import('../../src/stations/planner.js');
    await expect(
      generatePlan('Build something', config, { maxRetries: 3 }),
    ).rejects.toThrow('Planner failed to resolve write overlaps after 3 attempts');
  });

  it('throws when query produces no output', async () => {
    setQueryEmpty();

    const { generatePlan } = await import('../../src/stations/planner.js');
    await expect(
      generatePlan('Build something', config),
    ).rejects.toThrow('Planner produced no output');
  });

  it('throws on invalid dependency references', async () => {
    const badPlan = makePlan({
      tasks: [
        {
          id: 'task-001',
          description: 'Task with bad dep',
          writes: ['src/a.ts'],
          reads: [],
          dependsOn: ['nonexistent-task'],
          acceptanceCriteria: [],
        },
      ],
    });
    setQueryResult(badPlan);

    const { generatePlan } = await import('../../src/stations/planner.js');
    await expect(
      generatePlan('Build something', config, { maxRetries: 0 }),
    ).rejects.toThrow('Invalid dependency references');
  });
});
