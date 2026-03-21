import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CostTracker } from '../../src/cost/tracker.js';
import { CostReportSchema } from '../../src/schemas/reports.js';

describe('Cost report integration', () => {
  let tempDir: string;
  let anvilDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'anvil-cost-'));
    anvilDir = join(tempDir, '.anvil');
    await mkdir(anvilDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('Test 4: Cost report JSON file is written to .anvil/cost-report.json', async () => {
    const tracker = new CostTracker();
    tracker.record({
      agent: 'planner',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-20250514',
    });

    const report = tracker.toCostReport('test-session-1');
    const reportPath = join(anvilDir, 'cost-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));

    // Read back and verify it's valid JSON
    const raw = await readFile(reportPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.sessionId).toBe('test-session-1');
  });

  it('Test 5: Cost report contains entries with agent names and valid costUsd values', async () => {
    const tracker = new CostTracker();
    tracker.record({
      agent: 'planner',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-20250514',
    });
    tracker.recordFromResponse(
      { usage: { input_tokens: 2000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
      'worker:task-001',
      'claude-sonnet-4-20250514',
      1,
    );
    tracker.record({
      agent: 'high-court',
      inputTokens: 800,
      outputTokens: 400,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-20250514',
    });

    const report = tracker.toCostReport('test-session-2');
    const reportPath = join(anvilDir, 'cost-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));

    const raw = await readFile(reportPath, 'utf-8');
    const parsed = CostReportSchema.parse(JSON.parse(raw));

    expect(parsed.entries).toHaveLength(3);
    const agents = parsed.entries.map((e) => e.agent);
    expect(agents).toContain('planner');
    expect(agents).toContain('worker:task-001');
    expect(agents).toContain('high-court');

    for (const entry of parsed.entries) {
      expect(entry.costUsd).toBeGreaterThan(0);
    }
  });

  it('Test 6: Cost report has totalCostUsd matching sum of entry costs', async () => {
    const tracker = new CostTracker();
    tracker.record({
      agent: 'planner',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-20250514',
    });
    tracker.record({
      agent: 'worker',
      inputTokens: 2000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: 'claude-sonnet-4-20250514',
    });

    const report = tracker.toCostReport('test-session-3');
    const reportPath = join(anvilDir, 'cost-report.json');
    await writeFile(reportPath, JSON.stringify(report, null, 2));

    const raw = await readFile(reportPath, 'utf-8');
    const parsed = CostReportSchema.parse(JSON.parse(raw));

    const entrySum = parsed.entries.reduce((sum, e) => sum + e.costUsd, 0);
    expect(parsed.totalCostUsd).toBeCloseTo(entrySum, 10);
    expect(parsed.totalCostUsd).toBeGreaterThan(0);
  });
});
