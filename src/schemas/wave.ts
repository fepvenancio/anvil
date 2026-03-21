import { z } from 'zod/v4';

export const WaveStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

export const WaveSchema = z.object({
  waveNumber: z.number().int().min(1),
  taskIds: z.array(z.string()),
  status: WaveStatusSchema,
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});

export const WaveStateSchema = z.object({
  waves: z.array(WaveSchema),
  currentWave: z.number().int().min(0),
});

export type WaveStatus = z.infer<typeof WaveStatusSchema>;
export type Wave = z.infer<typeof WaveSchema>;
export type WaveState = z.infer<typeof WaveStateSchema>;
