import { z } from 'zod/v4';
import { PlanSchema } from './plan.js';
import { WaveSchema } from './wave.js';

export const SessionStatusSchema = z.enum(['planning', 'executing', 'reviewing', 'completed', 'failed', 'aborted']);

export const SessionStateSchema = z.object({
  sessionId: z.string(),
  spec: z.string(),
  status: SessionStatusSchema,
  plan: PlanSchema.optional(),
  waves: z.array(WaveSchema).default([]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
});

export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
