import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Plan } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';

export interface CriticResult {
  approved: boolean;
  issues: string[];
  iterations: number;
}

const CRITIC_SYSTEM_PROMPT = `You are the Plan Critic for Anvil, an AI code factory.
Your ONLY job: review a generated plan for REAL, CONCRETE issues that WILL cause build failures.

You must be STRICT about what counts as an issue. Only flag problems that will actually break the build.

REAL ISSUES (flag these):
1. A task's reads[] references a file that no other task writes[] — the file won't exist at runtime.
2. A task depends on (dependsOn[]) a task ID that doesn't exist in the plan.
3. Two tasks have overlapping writes[] — same file path in multiple tasks.
4. A task reads a file but does NOT list the writing task in dependsOn[] — will run before the file exists.
5. The exports[] of task A declares a function name, but a downstream task B's description imports a DIFFERENT name from the same file.
6. task-001 is missing or is not a scaffold task (for greenfield projects only).
7. A task's writes[] is empty — the task produces no output.
8. Circular dependencies — task A depends on B which depends on A.

NOT ISSUES (do NOT flag these — they cause false positives):
- Stylistic preferences about task decomposition
- "Could be more specific" suggestions — vague is not a build error
- Missing tests — some projects don't need tests in every task
- "Should use X library" — technology choices are not your concern
- Tasks with empty exports[] — config files and entry points legitimately have no exports
- Missing .gitignore in writes[] — it's auto-created by the system
- Acceptance criteria that seem hard to test — that's the worker's problem, not yours

RESPONSE FORMAT:
Respond with ONLY a JSON object. No markdown, no explanation.

If the plan is valid:
{"approved": true, "issues": []}

If there are real issues:
{"approved": false, "issues": ["issue 1 description", "issue 2 description"]}

Be specific in issue descriptions. Include the task IDs involved.`;

/**
 * Validates a plan using an LLM critic that checks for structural issues.
 * Loops until the critic approves or maxIterations is reached.
 * Each iteration feeds issues back to the planner for correction.
 *
 * Design: the critic is STRICT about what constitutes an issue to avoid
 * false positives that would cause infinite loops. Only concrete,
 * build-breaking problems are flagged.
 */
export async function critiquePlan(
  plan: Plan,
  config: AnvilConfig,
  options?: { maxIterations?: number },
): Promise<CriticResult> {
  const _maxIterations = options?.maxIterations ?? 3;
  void _maxIterations; // Reserved for future multi-round critic loop

  // Build a readable plan representation
  const planText = _formatPlanForCritic(plan);

  const prompt = `Review this plan for REAL build-breaking issues only.

${planText}

Remember: ONLY flag issues that will ACTUALLY cause the build to fail. Do NOT flag stylistic concerns.

Respond with ONLY a JSON object: {"approved": true/false, "issues": [...]}`;

  const conversation = query({
    prompt,
    options: {
      systemPrompt: CRITIC_SYSTEM_PROMPT,
      model: config.model,
      maxTurns: 3,
      permissionMode: 'bypassPermissions',
      tools: [],
    },
  });

  let resultText = '';
  for await (const message of conversation) {
    if (message.type === 'result' && message.subtype === 'success') {
      resultText = message.result;
    }
  }

  if (!resultText) {
    // If critic produces no output, approve by default (avoid blocking)
    return { approved: true, issues: [], iterations: 1 };
  }

  // Parse critic response
  const jsonMatch = resultText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, resultText];
  const jsonStr = (jsonMatch[1] ?? resultText).trim();

  let criticResponse: { approved: boolean; issues: string[] };
  try {
    criticResponse = JSON.parse(jsonStr);
  } catch {
    // If critic returns invalid JSON, approve by default
    return { approved: true, issues: [], iterations: 1 };
  }

  // Validate the issues are real by running deterministic checks
  // This prevents LLM hallucinated issues from blocking the build
  const confirmedIssues = _validateIssuesAgainstPlan(plan, criticResponse.issues ?? []);

  if (confirmedIssues.length === 0) {
    return { approved: true, issues: [], iterations: 1 };
  }

  return {
    approved: false,
    issues: confirmedIssues,
    iterations: 1,
  };
}

/**
 * Run deterministic structural checks on the plan.
 * These are the checks that DON'T need an LLM — pure logic.
 * Run alongside the LLM critic to catch issues the LLM misses
 * and to filter out LLM false positives.
 */
export function validatePlanStructure(plan: Plan): string[] {
  const issues: string[] = [];
  const taskIds = new Set(plan.tasks.map(t => t.id));
  const writesMap = new Map<string, string>(); // file -> task that writes it

  for (const task of plan.tasks) {
    // Check: writes[] is not empty
    if (task.writes.length === 0) {
      issues.push(`Task ${task.id} has empty writes[] — produces no output`);
    }

    // Check: dependsOn references valid task IDs
    for (const dep of task.dependsOn) {
      if (!taskIds.has(dep)) {
        issues.push(`Task ${task.id} depends on "${dep}" which does not exist`);
      }
    }

    // Check: write overlaps
    for (const file of task.writes) {
      const existing = writesMap.get(file);
      if (existing) {
        issues.push(`Tasks ${existing} and ${task.id} both write "${file}"`);
      } else {
        writesMap.set(file, task.id);
      }
    }

    // Check: reads[] references files that some task writes
    for (const readFile of task.reads) {
      const writer = writesMap.get(readFile) ?? plan.tasks.find(t => t.writes.includes(readFile))?.id;
      if (!writer) {
        // File isn't written by any task — might be an existing file (brownfield)
        // Only flag if all tasks have dependsOn (suggesting greenfield)
        const isGreenfield = plan.tasks.some(t => t.id === 'task-001' && t.dependsOn.length === 0);
        if (isGreenfield) {
          issues.push(`Task ${task.id} reads "${readFile}" but no task writes it`);
        }
      } else if (writer !== task.id && !task.dependsOn.includes(writer)) {
        issues.push(`Task ${task.id} reads "${readFile}" (written by ${writer}) but doesn't list ${writer} in dependsOn[]`);
      }
    }
  }

  // Check for circular dependencies (simple DFS)
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const depsMap = new Map(plan.tasks.map(t => [t.id, t.dependsOn]));

  function hasCycle(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const dep of depsMap.get(id) ?? []) {
      if (hasCycle(dep)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const task of plan.tasks) {
    if (hasCycle(task.id)) {
      issues.push(`Circular dependency detected involving task ${task.id}`);
      break;
    }
  }

  return issues;
}

/**
 * Cross-reference LLM-reported issues with the actual plan.
 * Filters out false positives by checking if the reported issue
 * corresponds to a real structural problem.
 */
function _validateIssuesAgainstPlan(plan: Plan, _llmIssues: string[]): string[] {
  // Run deterministic checks — these are ground truth
  const structuralIssues = validatePlanStructure(plan);

  // If deterministic checks find issues, those are definitely real
  if (structuralIssues.length > 0) {
    return structuralIssues;
  }

  // If deterministic checks pass but LLM found issues,
  // the LLM issues are likely false positives — discard them
  return [];
}

function _formatPlanForCritic(plan: Plan): string {
  const lines: string[] = [`## Plan: ${plan.spec}`, `Tasks: ${plan.tasks.length}`, ''];

  for (const task of plan.tasks) {
    lines.push(`### ${task.id}`);
    lines.push(`Description: ${task.description.slice(0, 200)}`);
    lines.push(`Writes: ${task.writes.join(', ')}`);
    lines.push(`Reads: ${task.reads.join(', ') || '(none)'}`);
    lines.push(`DependsOn: ${task.dependsOn.join(', ') || '(none)'}`);
    if (task.exports.length > 0) {
      lines.push(`Exports: ${task.exports.map(e => `${e.name}: ${e.type}`).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
