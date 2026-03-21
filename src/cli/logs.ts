import { Command } from 'commander';
import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface PinoLogEntry {
  level: number;
  time: number;
  msg: string;
  wave?: number;
  waveNumber?: number;
  taskId?: string;
  task?: string;
  [key: string]: unknown;
}

const LEVEL_NAMES: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

const LEVEL_COLORS: Record<number, (s: string) => string> = {
  10: chalk.gray,
  20: chalk.gray,
  30: chalk.blue,
  40: chalk.yellow,
  50: chalk.red,
  60: chalk.red.bold,
};

function levelNameToNumber(name: string): number | undefined {
  const map: Record<string, number> = {
    trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60,
  };
  return map[name.toLowerCase()];
}

/**
 * Reads and displays logs from .anvil/logs/anvil.log (pino newline-delimited JSON).
 * Supports --wave, --task, --level, -n filters.
 */
export const logsCommand = new Command('logs')
  .description('View build logs, optionally filtered by wave or task')
  .option('--wave <n>', 'Filter to a specific wave number')
  .option('--task <id>', 'Filter to logs mentioning a specific task ID')
  .option('--level <level>', 'Filter by log level (trace, debug, info, warn, error, fatal)')
  .option('-n, --lines <n>', 'Number of lines to show (from tail)', '50')
  .action(async (opts: { wave?: string; task?: string; level?: string; lines?: string }) => {
    const anvilDir = join(process.cwd(), '.anvil');
    await showLogs(anvilDir, opts);
  });

export async function showLogs(
  anvilDir: string,
  opts: { wave?: string; task?: string; level?: string; lines?: string } = {},
): Promise<string> {
  const logPath = join(anvilDir, 'logs', 'anvil.log');

  let raw: string;
  try {
    raw = await readFile(logPath, 'utf-8');
  } catch {
    const msg = 'No logs found. Logs are generated during `anvil run`.';
    console.log(msg);
    return msg;
  }

  if (raw.trim().length === 0) {
    const msg = 'No logs found. Logs are generated during `anvil run`.';
    console.log(msg);
    return msg;
  }

  // Parse log lines
  let entries: PinoLogEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      entries.push(JSON.parse(line) as PinoLogEntry);
    } catch {
      // skip malformed lines
    }
  }

  // Apply filters
  if (opts.wave != null) {
    const waveNum = parseInt(opts.wave, 10);
    entries = entries.filter(e => e.wave === waveNum || e.waveNumber === waveNum);
  }

  if (opts.task != null) {
    const taskId = opts.task;
    entries = entries.filter(e => e.taskId === taskId || e.task === taskId || e.msg.includes(taskId));
  }

  if (opts.level != null) {
    const levelNum = levelNameToNumber(opts.level);
    if (levelNum != null) {
      entries = entries.filter(e => e.level >= levelNum);
    }
  }

  // Limit from tail
  const lineLimit = parseInt(opts.lines ?? '50', 10);
  if (entries.length > lineLimit) {
    entries = entries.slice(-lineLimit);
  }

  if (entries.length === 0) {
    const msg = 'No matching log entries.';
    console.log(msg);
    return msg;
  }

  // Format output
  const lines: string[] = [];
  for (const entry of entries) {
    const time = new Date(entry.time).toISOString().slice(11, 19); // HH:MM:SS
    const levelName = LEVEL_NAMES[entry.level] ?? `L${entry.level}`;
    const colorFn = LEVEL_COLORS[entry.level] ?? chalk.white;
    const prefix = `${chalk.dim(time)} ${colorFn(levelName.padEnd(5))}`;
    const extra: string[] = [];
    if (entry.wave != null || entry.waveNumber != null) {
      extra.push(`wave=${entry.wave ?? entry.waveNumber}`);
    }
    if (entry.taskId ?? entry.task) {
      extra.push(`task=${entry.taskId ?? entry.task}`);
    }
    const suffix = extra.length > 0 ? chalk.dim(` [${extra.join(', ')}]`) : '';
    lines.push(`${prefix} ${entry.msg}${suffix}`);
  }

  const output = lines.join('\n');
  console.log(output);
  return output;
}
