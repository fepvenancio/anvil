import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { showCost } from '../../src/cli/cost.js';

describe('anvil cost', () => {
  let anvilDir: string;
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(async () => {
    anvilDir = join(tmpdir(), `anvil-test-cost-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(anvilDir, { recursive: true });
    consoleSpy.mockClear();
  });

  afterEach(async () => {
    await rm(anvilDir, { recursive: true, force: true });
  });

  it('shows "No cost data found" when cost-report.json missing', async () => {
    const output = await showCost(anvilDir);
    expect(output).toContain('No cost data found');
    expect(output).toContain('anvil run');
  });

  it('displays agent names and total cost from cost report', async () => {
    const report = {
      sessionId: 'test-session',
      entries: [
        { agent: 'planner', inputTokens: 1200, outputTokens: 3400, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.052 },
        { agent: 'worker:task-001', inputTokens: 2100, outputTokens: 5600, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.091 },
      ],
      totalCostUsd: 0.143,
      timestamp: new Date().toISOString(),
    };
    await writeFile(join(anvilDir, 'cost-report.json'), JSON.stringify(report));

    const output = await showCost(anvilDir);
    expect(output).toContain('planner');
    expect(output).toContain('worker:task-001');
    expect(output).toContain('$0.1430');
  });

  it('groups entries by wave number with --by-wave flag', async () => {
    const report = {
      sessionId: 'test-session',
      entries: [
        { agent: 'planner', inputTokens: 1000, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, waveNumber: 1, costUsd: 0.03 },
        { agent: 'worker:t1', inputTokens: 500, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, waveNumber: 1, costUsd: 0.015 },
        { agent: 'worker:t2', inputTokens: 800, outputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0, waveNumber: 2, costUsd: 0.025 },
        { agent: 'high-court', inputTokens: 600, outputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01 },
      ],
      totalCostUsd: 0.08,
      timestamp: new Date().toISOString(),
    };
    await writeFile(join(anvilDir, 'cost-report.json'), JSON.stringify(report));

    const output = await showCost(anvilDir, { byWave: true });
    expect(output).toContain('by wave');
    expect(output).toContain('Wave 1');
    expect(output).toContain('Wave 2');
    expect(output).toContain('Other');
    expect(output).toContain('high-court');
  });

  it('handles empty entries array', async () => {
    const report = {
      sessionId: 'test-session',
      entries: [],
      totalCostUsd: 0,
      timestamp: new Date().toISOString(),
    };
    await writeFile(join(anvilDir, 'cost-report.json'), JSON.stringify(report));

    const output = await showCost(anvilDir);
    expect(output).toContain('No API calls recorded');
  });
});
