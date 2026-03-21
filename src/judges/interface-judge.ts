import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SubJudgeCheck } from '../schemas/reports.js';
import type { Task } from '../schemas/plan.js';

/**
 * Validates that worker output matches the exports[] interface contracts from the plan.
 * Parses actual export statements from generated files and compares against planned names.
 * Pure code check — no LLM, $0 cost.
 */
export async function runInterfaceCheck(
  projectDir: string,
  tasks: Task[],
): Promise<SubJudgeCheck> {
  const mismatches: string[] = [];

  for (const task of tasks) {
    if (task.exports.length === 0) continue;

    // Collect all actual exports from source files this task writes
    // Skip config files (vitest.config.ts, tsconfig.json, etc.) — they don't have meaningful exports
    const allActualExports = new Set<string>();
    const SOURCE_FILE_RE = /\.(ts|tsx|js|jsx|mts|mjs)$/;
    const CONFIG_FILE_RE = /\.config\.(ts|js|mts|mjs)$|tsconfig|\.json$|\.gitignore$/;

    for (const file of task.writes) {
      if (!SOURCE_FILE_RE.test(file)) continue;
      if (CONFIG_FILE_RE.test(file)) continue; // Skip config files

      let content: string;
      try {
        content = await readFile(join(projectDir, file), 'utf-8');
      } catch {
        continue; // File doesn't exist yet — skip
      }

      for (const name of extractExportNames(content)) {
        allActualExports.add(name);
      }
    }

    // If the task has no non-config source files (e.g., scaffold), skip
    const hasSourceFiles = task.writes.some(f => SOURCE_FILE_RE.test(f) && !CONFIG_FILE_RE.test(f));
    if (!hasSourceFiles) {
      continue;
    }

    // Check each planned export exists in the actual output
    for (const planned of task.exports) {
      const found = allActualExports.has(planned.name)
        // Treat "export default" as matching the single planned export name
        // (common pattern: plan says "app", worker does "export default app")
        || (allActualExports.has('default') && task.exports.length === 1);
      if (!found) {
        mismatches.push(
          `${task.id}: should export "${planned.name}" but doesn't. Actual: [${[...allActualExports].join(', ')}]`,
        );
      }
    }
  }

  if (mismatches.length === 0) {
    return { name: 'interface', passed: true };
  }

  return {
    name: 'interface',
    passed: false,
    message: `${mismatches.length} export contract mismatch(es)`,
    details: mismatches.join('\n'),
  };
}

/**
 * Extract exported identifier names from TypeScript/JavaScript source.
 * Handles: export function, export const, export class, export type,
 * export interface, export enum, export default, export { named }.
 */
function extractExportNames(source: string): Set<string> {
  const names = new Set<string>();

  // export function/const/let/var/class/type/interface/enum NAME
  const declRegex = /export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = declRegex.exec(source)) !== null) {
    names.add(match[1]);
  }

  // export default function/class NAME
  const defaultRegex = /export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/g;
  while ((match = defaultRegex.exec(source)) !== null) {
    names.add(match[1]);
    names.add('default');
  }

  // export default (anonymous)
  if (/export\s+default\s+[^{]/.test(source)) {
    names.add('default');
  }

  // export { name1, name2, name3 as alias }
  const namedRegex = /export\s*\{([^}]+)\}/g;
  while ((match = namedRegex.exec(source)) !== null) {
    const inner = match[1];
    for (const part of inner.split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }

  return names;
}
