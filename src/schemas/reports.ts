import { z } from 'zod/v4';

export const SubJudgeCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  message: z.string().optional(),
  details: z.string().optional(),
});

export const SubJudgeReportSchema = z.object({
  waveNumber: z.number().int(),
  checks: z.array(SubJudgeCheckSchema),
  allPassed: z.boolean(),
  timestamp: z.string().datetime(),
});

export const HighCourtVerdictSchema = z.enum(['merge', 'human_required', 'abort']);

export const HighCourtReportSchema = z.object({
  verdict: HighCourtVerdictSchema,
  reasoning: z.string(),
  concerns: z.array(z.string()),
  invariantChecks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    detail: z.string().optional(),
  })),
  timestamp: z.string().datetime(),
});

export const CostEntrySchema = z.object({
  agent: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int().default(0),
  cacheWriteTokens: z.number().int().default(0),
  waveNumber: z.number().int().optional(),
  costUsd: z.number(),
});

export const CostReportSchema = z.object({
  sessionId: z.string(),
  entries: z.array(CostEntrySchema),
  totalCostUsd: z.number(),
  timestamp: z.string().datetime(),
});

export type SubJudgeCheck = z.infer<typeof SubJudgeCheckSchema>;
export type SubJudgeReport = z.infer<typeof SubJudgeReportSchema>;
export type HighCourtVerdict = z.infer<typeof HighCourtVerdictSchema>;
export type HighCourtReport = z.infer<typeof HighCourtReportSchema>;
export type CostEntry = z.infer<typeof CostEntrySchema>;
export type CostReport = z.infer<typeof CostReportSchema>;
