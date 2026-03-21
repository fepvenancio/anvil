import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { showLogs } from '../../src/cli/logs.js';

function pinoLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: Date.now(),
    msg: 'test message',
    ...overrides,
  });
}

describe('anvil logs', () => {
  let anvilDir: string;
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  beforeEach(async () => {
    anvilDir = join(tmpdir(), `anvil-test-logs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(anvilDir, 'logs'), { recursive: true });
    consoleSpy.mockClear();
  });

  afterEach(async () => {
    await rm(anvilDir, { recursive: true, force: true });
  });

  it('shows "No logs found" when log file is missing', async () => {
    const output = await showLogs(anvilDir);
    expect(output).toContain('No logs found');
    expect(output).toContain('anvil run');
  });

  it('shows "No logs found" when log file is empty', async () => {
    await writeFile(join(anvilDir, 'logs', 'anvil.log'), '');
    const output = await showLogs(anvilDir);
    expect(output).toContain('No logs found');
  });

  it('displays formatted pino log entries', async () => {
    const lines = [
      pinoLine({ msg: 'Starting build', level: 30 }),
      pinoLine({ msg: 'Task complete', level: 30 }),
    ].join('\n');
    await writeFile(join(anvilDir, 'logs', 'anvil.log'), lines);

    const output = await showLogs(anvilDir);
    expect(output).toContain('Starting build');
    expect(output).toContain('Task complete');
  });

  it('filters by wave number with --wave flag', async () => {
    const lines = [
      pinoLine({ msg: 'wave 1 task', wave: 1 }),
      pinoLine({ msg: 'wave 2 task', wave: 2 }),
      pinoLine({ msg: 'wave 1 another', wave: 1 }),
    ].join('\n');
    await writeFile(join(anvilDir, 'logs', 'anvil.log'), lines);

    const output = await showLogs(anvilDir, { wave: '1' });
    expect(output).toContain('wave 1 task');
    expect(output).toContain('wave 1 another');
    expect(output).not.toContain('wave 2 task');
  });

  it('filters by task ID with --task flag', async () => {
    const lines = [
      pinoLine({ msg: 'executing', taskId: 'task-001' }),
      pinoLine({ msg: 'executing', taskId: 'task-002' }),
    ].join('\n');
    await writeFile(join(anvilDir, 'logs', 'anvil.log'), lines);

    const output = await showLogs(anvilDir, { task: 'task-001' });
    expect(output).toContain('task-001');
    expect(output).not.toContain('task-002');
  });

  it('limits output to -n lines from tail', async () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      pinoLine({ msg: `line ${i + 1}` }),
    ).join('\n');
    await writeFile(join(anvilDir, 'logs', 'anvil.log'), lines);

    const output = await showLogs(anvilDir, { lines: '5' });
    expect(output).toContain('line 16');
    expect(output).toContain('line 20');
    expect(output).not.toContain('line 15');
  });

  it('filters by level showing entries at or above threshold', async () => {
    const lines = [
      pinoLine({ msg: 'info msg', level: 30 }),
      pinoLine({ msg: 'warn msg', level: 40 }),
      pinoLine({ msg: 'error msg', level: 50 }),
    ].join('\n');
    await writeFile(join(anvilDir, 'logs', 'anvil.log'), lines);

    const output = await showLogs(anvilDir, { level: 'warn' });
    expect(output).toContain('warn msg');
    expect(output).toContain('error msg');
    expect(output).not.toContain('info msg');
  });

  it('shows "No matching log entries" when filters match nothing', async () => {
    const lines = [pinoLine({ msg: 'test', wave: 1 })].join('\n');
    await writeFile(join(anvilDir, 'logs', 'anvil.log'), lines);

    const output = await showLogs(anvilDir, { wave: '99' });
    expect(output).toContain('No matching log entries');
  });
});
