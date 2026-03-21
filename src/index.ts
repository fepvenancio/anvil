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
