import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { PlanSchema, type Plan } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';
import { detectWriteOverlaps } from '../core/validator.js';
import { validateDependencyRefs } from '../core/topological-sort.js';
import { PLANNER_SYSTEM_PROMPT } from '../prompts/planner-system.js';

export interface GeneratePlanOptions {
  /** Provide a pre-configured Anthropic client (useful for testing). */
  client?: Anthropic;
  /** Maximum number of re-plan attempts on write overlap. Default: 3. */
  maxRetries?: number;
}

/**
 * Generates a validated plan from a natural-language spec using Claude
 * with structured outputs (zodOutputFormat + PlanSchema).
 *
 * Retries up to maxRetries times if the LLM produces overlapping writes.
 * Throws on persistent overlaps or invalid dependency references.
 */
export async function generatePlan(
  spec: string,
  config: AnvilConfig,
  options?: GeneratePlanOptions,
): Promise<Plan> {
  const client = options?.client ?? new Anthropic();
  const maxRetries = options?.maxRetries ?? 3;

  return _generateWithRetry(client, config, spec, [], maxRetries);
}

async function _generateWithRetry(
  client: Anthropic,
  config: AnvilConfig,
  spec: string,
  extraMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  retriesRemaining: number,
): Promise<Plan> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: spec },
    ...extraMessages,
  ];

  const response = await (client.messages as any).parse({
    model: config.model,
    max_tokens: 16384,
    system: PLANNER_SYSTEM_PROMPT,
    messages,
    output_config: { format: zodOutputFormat(PlanSchema) },
  });

  const plan: Plan | null | undefined = response.parsed_output;

  if (!plan) {
    throw new Error('Planner produced no output');
  }

  // Check for write overlaps
  const overlaps = detectWriteOverlaps(plan.tasks);
  if (overlaps.length > 0) {
    if (retriesRemaining <= 0) {
      throw new Error(
        'Planner failed to resolve write overlaps after 3 attempts',
      );
    }

    const overlapDesc = overlaps
      .map(
        (o) =>
          `- Tasks "${o.taskA}" and "${o.taskB}" both write to: ${o.overlappingFiles.join(', ')}`,
      )
      .join('\n');

    const feedback = `Your plan has write overlaps that must be fixed:\n${overlapDesc}\nPlease regenerate the plan with no overlapping writes.`;

    // We need to include the assistant's response and the user's feedback
    return _generateWithRetry(
      client,
      config,
      spec,
      [
        ...extraMessages,
        // Simulate the assistant having responded (the LLM output)
        {
          role: 'assistant' as const,
          content: JSON.stringify(plan),
        },
        { role: 'user' as const, content: feedback },
      ],
      retriesRemaining - 1,
    );
  }

  // Check for invalid dependency references
  const depErrors = validateDependencyRefs(plan.tasks);
  if (depErrors.length > 0) {
    throw new Error(`Invalid dependency references: ${depErrors.join('; ')}`);
  }

  return plan;
}
