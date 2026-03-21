import { z } from 'zod/v4';

export const AnvilConfigSchema = z.object({
  projectName: z.string().default('anvil-project'),
  model: z.string().default('claude-sonnet-4-6'),
  maxWorkers: z.number().int().min(1).max(16).default(4),
  anvilDir: z.string().default('.anvil'),
  /** Wall-clock timeout per worker in milliseconds. Default: 5 minutes. */
  workerTimeoutMs: z.number().int().min(30_000).default(300_000),
});

export type AnvilConfig = z.infer<typeof AnvilConfigSchema>;
