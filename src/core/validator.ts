import { PlanSchema, type Plan, type Task } from '../schemas/plan.js';
import { validateDependencyRefs } from './topological-sort.js';

export interface ValidationResult {
  valid: boolean;
  plan?: Plan;
  errors?: string[];
}

export function validatePlan(data: unknown): ValidationResult {
  const result = PlanSchema.safeParse(data);
  if (result.success) {
    return { valid: true, plan: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    ),
  };
}

/**
 * Detects pairs of tasks that have overlapping writes[] entries.
 * Returns an array of overlap descriptors (empty if no overlaps).
 */
export function detectWriteOverlaps(
  tasks: Task[],
): Array<{ taskA: string; taskB: string; overlappingFiles: string[] }> {
  const overlaps: Array<{
    taskA: string;
    taskB: string;
    overlappingFiles: string[];
  }> = [];

  for (let i = 0; i < tasks.length; i++) {
    const writesA = new Set(tasks[i].writes);
    for (let j = i + 1; j < tasks.length; j++) {
      const overlapping = tasks[j].writes.filter((f) => writesA.has(f));
      if (overlapping.length > 0) {
        overlaps.push({
          taskA: tasks[i].id,
          taskB: tasks[j].id,
          overlappingFiles: overlapping,
        });
      }
    }
  }

  return overlaps;
}

/**
 * Full plan validation: schema + overlap detection + dependency ref validation.
 * Extends validatePlan with additional semantic checks.
 */
export function validatePlanFull(data: unknown): ValidationResult {
  const schemaResult = validatePlan(data);
  if (!schemaResult.valid || !schemaResult.plan) {
    return schemaResult;
  }

  const plan = schemaResult.plan;

  // Check for write overlaps
  const overlaps = detectWriteOverlaps(plan.tasks);
  if (overlaps.length > 0) {
    return {
      valid: false,
      errors: overlaps.map(
        (o) =>
          `Write overlap: tasks ${o.taskA} and ${o.taskB} both write to: ${o.overlappingFiles.join(', ')}`,
      ),
    };
  }

  // Check for invalid dependency references
  const depErrors = validateDependencyRefs(plan.tasks);
  if (depErrors.length > 0) {
    return {
      valid: false,
      errors: depErrors,
    };
  }

  return schemaResult;
}
