import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { showStatus } from '../../src/cli/status.js';

describe('anvil status', () => {
  let anvilDir: string;
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(async () => {
    anvilDir = join(tmpdir(), `anvil-test-status-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(anvilDir, 'reports'), { recursive: true });
    consoleSpy.mockClear();
  });

  afterEach(async () => {
    await rm(anvilDir, { recursive: true, force: true });
  });

  it('shows "No build data found" when .anvil/ is empty', async () => {
    const output = await showStatus(anvilDir);
    expect(output).toContain('No build data found');
    expect(output).toContain('anvil run');
  });

  it('shows wave progress from wave judge reports', async () => {
    const report = {
      waveNumber: 1,
      checks: [
        { name: 'tsc', passed: true, message: 'compiled ok' },
        { name: 'vitest', passed: true, message: 'all tests pass' },
      ],
      allPassed: true,
      timestamp: new Date().toISOString(),
    };
    await writeFile(
      join(anvilDir, 'reports', 'wave-1-judges.json'),
      JSON.stringify(report),
    );

    const output = await showStatus(anvilDir);
    expect(output).toContain('Wave 1');
    expect(output).toContain('all passed');
    expect(output).toContain('tsc');
    expect(output).toContain('vitest');
  });

  it('shows failed checks with failure count', async () => {
    const report = {
      waveNumber: 2,
      checks: [
        { name: 'tsc', passed: true },
        { name: 'vitest', passed: false, message: '3 tests failed' },
        { name: 'touch-map', passed: false, message: 'unauthorized file' },
      ],
      allPassed: false,
      timestamp: new Date().toISOString(),
    };
    await writeFile(
      join(anvilDir, 'reports', 'wave-2-judges.json'),
      JSON.stringify(report),
    );

    const output = await showStatus(anvilDir);
    expect(output).toContain('Wave 2');
    expect(output).toContain('2/3 failed');
  });

  it('shows High Court verdict with reasoning', async () => {
    const highCourt = {
      verdict: 'merge' as const,
      reasoning: 'Code quality is excellent',
      concerns: [],
      invariantChecks: [{ name: 'no-secrets', passed: true }],
      timestamp: new Date().toISOString(),
    };
    await writeFile(
      join(anvilDir, 'high-court-report.json'),
      JSON.stringify(highCourt),
    );

    const output = await showStatus(anvilDir);
    expect(output).toContain('MERGE');
    expect(output).toContain('Code quality is excellent');
  });

  it('shows High Court concerns when present', async () => {
    const highCourt = {
      verdict: 'human_required' as const,
      reasoning: 'Needs review',
      concerns: ['Missing error handling', 'No input validation'],
      invariantChecks: [],
      timestamp: new Date().toISOString(),
    };
    await writeFile(
      join(anvilDir, 'high-court-report.json'),
      JSON.stringify(highCourt),
    );

    const output = await showStatus(anvilDir);
    expect(output).toContain('HUMAN_REQUIRED');
    expect(output).toContain('Missing error handling');
    expect(output).toContain('No input validation');
  });

  it('handles both wave reports and high court together', async () => {
    const waveReport = {
      waveNumber: 1,
      checks: [{ name: 'tsc', passed: true }],
      allPassed: true,
      timestamp: new Date().toISOString(),
    };
    await writeFile(
      join(anvilDir, 'reports', 'wave-1-judges.json'),
      JSON.stringify(waveReport),
    );

    const highCourt = {
      verdict: 'merge' as const,
      reasoning: 'Approved',
      concerns: [],
      invariantChecks: [],
      timestamp: new Date().toISOString(),
    };
    await writeFile(
      join(anvilDir, 'high-court-report.json'),
      JSON.stringify(highCourt),
    );

    const output = await showStatus(anvilDir);
    expect(output).toContain('Wave 1');
    expect(output).toContain('MERGE');
  });
});
