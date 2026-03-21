import { AnvilConfigSchema, type AnvilConfig } from '../schemas/config.js';
import { basename } from 'node:path';

export interface CliOptions {
  workers?: string;
  model?: string;
}

export function loadConfig(opts: CliOptions, cwd?: string): Readonly<AnvilConfig> {
  const raw: Record<string, unknown> = {};

  if (opts.workers) {
    raw.maxWorkers = parseInt(opts.workers, 10);
  }
  if (opts.model) {
    raw.model = opts.model;
  }
  if (cwd) {
    raw.projectName = basename(cwd);
  }

  return Object.freeze(AnvilConfigSchema.parse(raw));
}
