import { query } from '@anthropic-ai/claude-agent-sdk';
import { PlanSchema, type Plan } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';
import { detectWriteOverlaps } from '../core/validator.js';
import { validateDependencyRefs } from '../core/topological-sort.js';
import { PLANNER_SYSTEM_PROMPT, buildPlannerPrompt } from '../prompts/planner-system.js';
import type { StackPreset } from '../stacks/index.js';

export interface GeneratePlanOptions {
  /** Maximum number of re-plan attempts on write overlap. Default: 3. */
  maxRetries?: number;
  /** Pre-parsed plan for testing (skips AI call). */
  mockPlan?: Plan;
  /** Stack preset to inject into planner prompt. Uses default TypeScript if omitted. */
  stack?: StackPreset;
}

/**
 * Generates a validated plan from a natural-language spec using Claude Code Agent SDK.
 * Auth is inherited from the parent CLI environment (Claude Code, etc.).
 *
 * Retries up to maxRetries times if the LLM produces overlapping writes.
 * Throws on persistent overlaps or invalid dependency references.
 */
export async function generatePlan(
  spec: string,
  config: AnvilConfig,
  options?: GeneratePlanOptions,
): Promise<Plan> {
  // Testing shortcut
  if (options?.mockPlan) return options.mockPlan;

  const maxRetries = options?.maxRetries ?? 3;
  const systemPrompt = options?.stack ? buildPlannerPrompt(options.stack) : PLANNER_SYSTEM_PROMPT;
  return _generateWithRetry(config, spec, '', maxRetries, systemPrompt);
}

async function _generateWithRetry(
  config: AnvilConfig,
  spec: string,
  feedbackHistory: string,
  retriesRemaining: number,
  systemPrompt: string = PLANNER_SYSTEM_PROMPT,
): Promise<Plan> {
  const prompt = `${spec}${feedbackHistory ? `\n\n## Previous Feedback\n${feedbackHistory}` : ''}

IMPORTANT: Respond with ONLY a valid JSON object matching this exact schema. No markdown, no code fences, no explanation — just the raw JSON.

Schema:
{
  "id": "string (uuid format)",
  "spec": "string (the original spec)",
  "createdAt": "string (ISO date)",
  "tasks": [
    {
      "id": "string (task-001 format)",
      "description": "string",
      "writes": ["string (file paths this task creates/modifies)"],
      "reads": ["string (file paths this task reads for context)"],
      "dependsOn": ["string (task IDs that must complete before this one)"],
      "acceptanceCriteria": ["string (testable conditions)"],
      "exports": [{"name": "string (exported identifier)", "type": "string (TypeScript signature)"}]
    }
  ]
}

Rules:
- Each task's writes[] must NOT overlap with any other task's writes[]
- dependsOn must reference valid task IDs
- Order tasks so dependencies come first`;

  const conversation = query({
    prompt,
    options: {
      systemPrompt,
      model: config.model,
      maxTurns: 3,
      permissionMode: 'bypassPermissions',
      tools: [],  // Planner doesn't need tools — just generates JSON
    },
  });

  let resultText = '';
  for await (const message of conversation) {
    if (message.type === 'result' && message.subtype === 'success') {
      resultText = message.result;
    }
  }

  if (!resultText) {
    throw new Error('Planner produced no output');
  }

  // Extract JSON from response (may be wrapped in markdown code fences)
  const jsonMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, resultText];
  const jsonStr = (jsonMatch[1] ?? resultText).trim();

  // Parse and validate with Zod
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Planner returned invalid JSON: ${jsonStr.slice(0, 200)}`);
  }
  const parseResult = PlanSchema.safeParse(parsed);
  if (!parseResult.success) {
    throw new Error(`Planner output failed schema validation: ${parseResult.error.message}`);
  }

  const plan = parseResult.data;

  // Check for write overlaps
  const overlaps = detectWriteOverlaps(plan.tasks);
  if (overlaps.length > 0) {
    if (retriesRemaining <= 0) {
      throw new Error('Planner failed to resolve write overlaps after 3 attempts');
    }

    const overlapDesc = overlaps
      .map(
        (o) =>
          `- Tasks "${o.taskA}" and "${o.taskB}" both write to: ${o.overlappingFiles.join(', ')}`,
      )
      .join('\n');

    const feedback = `${feedbackHistory}\n\nYour plan has write overlaps that must be fixed:\n${overlapDesc}\nPlease regenerate the plan with no overlapping writes.`;

    return _generateWithRetry(config, spec, feedback, retriesRemaining - 1, systemPrompt);
  }

  // Check for invalid dependency references
  const depErrors = validateDependencyRefs(plan.tasks);
  if (depErrors.length > 0) {
    throw new Error(`Invalid dependency references: ${depErrors.join('; ')}`);
  }

  return plan;
}
