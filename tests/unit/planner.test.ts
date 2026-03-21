import { describe, it, expect, vi } from 'vitest';
import { generatePlan } from '../../src/stations/planner.js';
import type { AnvilConfig } from '../../src/schemas/config.js';
import type { Plan } from '../../src/schemas/plan.js';

const config: AnvilConfig = {
  projectName: 'test-project',
  model: 'claude-sonnet-4-6-20250520',
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
        description: 'Create the server entry point',
        writes: ['src/server.ts'],
        reads: [],
        dependsOn: [],
        acceptanceCriteria: ['Server starts on port 3000'],
      },
      {
        id: 'task-002',
        description: 'Create user routes',
        writes: ['src/routes/users.ts'],
        reads: ['src/server.ts'],
        dependsOn: ['task-001'],
        acceptanceCriteria: ['GET /users returns 200'],
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

function makeMockClient(parseFn: ReturnType<typeof vi.fn>) {
  return {
    messages: { parse: parseFn },
  } as any;
}

describe('generatePlan', () => {
  it('generates a valid plan from spec', async () => {
    const plan = makePlan();
    const parseFn = vi.fn().mockResolvedValue({ parsed_output: plan });
    const client = makeMockClient(parseFn);

    const result = await generatePlan('Build a REST API', config, { client });

    expect(result.id).toBe(plan.id);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].writes).toContain('src/server.ts');
    expect(result.tasks[1].dependsOn).toContain('task-001');
    expect(parseFn).toHaveBeenCalledOnce();
  });

  it('retries on write overlap then succeeds', async () => {
    const overlapping = makeOverlappingPlan();
    const clean = makePlan();
    const parseFn = vi
      .fn()
      .mockResolvedValueOnce({ parsed_output: overlapping })
      .mockResolvedValueOnce({ parsed_output: clean });
    const client = makeMockClient(parseFn);

    const result = await generatePlan('Build something', config, { client });

    expect(parseFn).toHaveBeenCalledTimes(2);
    expect(result.id).toBe(clean.id);
  });

  it('throws after max retries on persistent overlap', async () => {
    const overlapping = makeOverlappingPlan();
    const parseFn = vi
      .fn()
      .mockResolvedValue({ parsed_output: overlapping });
    const client = makeMockClient(parseFn);

    await expect(
      generatePlan('Build something', config, { client, maxRetries: 3 }),
    ).rejects.toThrow('Planner failed to resolve write overlaps after 3 attempts');
  });

  it('throws on null parsed_output', async () => {
    const parseFn = vi
      .fn()
      .mockResolvedValue({ parsed_output: null });
    const client = makeMockClient(parseFn);

    await expect(
      generatePlan('Build something', config, { client }),
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
    const parseFn = vi
      .fn()
      .mockResolvedValue({ parsed_output: badPlan });
    const client = makeMockClient(parseFn);

    await expect(
      generatePlan('Build something', config, { client }),
    ).rejects.toThrow('Invalid dependency references');
  });
});
