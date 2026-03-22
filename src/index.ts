// Library entry point — re-exports for programmatic usage
export * from './schemas/index.js';
export { initAnvilDir } from './core/anvil-dir.js';
export { loadConfig } from './core/config-loader.js';
export {
  validatePlan,
  validatePlanFull,
  detectWriteOverlaps,
  type ValidationResult,
} from './core/validator.js';
export {
  topologicalSort,
  validateDependencyRefs,
} from './core/topological-sort.js';
export { createLogger } from './core/logger.js';
export { WorktreeManager, validateTouchMap } from './git/worktree-manager.js';
export { executeTask, type WorkerResult } from './workers/worker.js';
export { promptPlanReview, editPlanInEditor, displayPlanSummary } from './ui/plan-review.js';
export { executeSequentially, type ExecutionResult } from './orchestrator/sequential-runner.js';
export { generatePlan } from './stations/planner.js';
export { PLANNER_SYSTEM_PROMPT } from './prompts/planner-system.js';
export { WORKER_SYSTEM_PROMPT } from './prompts/worker-system.js';
