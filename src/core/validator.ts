import { PlanSchema, type Plan } from '../schemas/plan.js';

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
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    ),
  };
}
