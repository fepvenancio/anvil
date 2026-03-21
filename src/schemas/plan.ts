import { z } from 'zod/v4';

export const TaskSchema = z.object({
  id: z.string(),
  description: z.string(),
  writes: z.array(z.string()),
  reads: z.array(z.string()),
  dependsOn: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
});

export const PlanSchema = z.object({
  id: z.string(),
  spec: z.string(),
  tasks: z.array(TaskSchema),
  createdAt: z.string().datetime(),
});

export type Task = z.infer<typeof TaskSchema>;
export type Plan = z.infer<typeof PlanSchema>;
