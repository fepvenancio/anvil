import { query } from '@anthropic-ai/claude-agent-sdk';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PlanSchema, type Plan } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';
import { detectWriteOverlaps } from '../core/validator.js';
import { validateDependencyRefs } from '../core/topological-sort.js';
import { PLANNER_SYSTEM_PROMPT, buildPlannerPrompt } from '../prompts/planner-system.js';
import type { StackPreset } from '../stacks/index.js';
import { validatePlanStructure } from './plan-critic.js';

const execFileAsync = promisify(execFile);

export interface GeneratePlanOptions {
  /** Maximum number of re-plan attempts on write overlap. Default: 3. */
  maxRetries?: number;
  /** Pre-parsed plan for testing (skips AI call). */
  mockPlan?: Plan;
  /** Stack preset to inject into planner prompt. Uses default TypeScript if omitted. */
  stack?: StackPreset;
  /** Project directory for brownfield detection. Default: process.cwd(). */
  projectDir?: string;
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
  const projectDir = options?.projectDir ?? process.cwd();

  // Brownfield detection: if project already has source files, inject context
  const projectContext = await _detectProjectContext(projectDir);
  const specWithContext = projectContext
    ? `${spec}\n\n## Existing Project Context\nThis is a BROWNFIELD project — files already exist. Do NOT generate a scaffold task-001. Instead, work with the existing structure.\n\n### File Tree\n${projectContext.fileTree}\n\n### Key File Signatures\n${projectContext.signatures}`
    : spec;

  return _generateWithRetry(config, specWithContext, '', maxRetries, systemPrompt);
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

  // Parse and validate with Zod — retry on invalid JSON or schema failure
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    if (retriesRemaining <= 0) {
      throw new Error(`Planner returned invalid JSON: ${jsonStr.slice(0, 200)}`);
    }
    const feedback = `${feedbackHistory}\n\nYou returned invalid JSON (not parseable). You MUST respond with ONLY a raw JSON object. No TypeScript code, no markdown, no explanation — just the JSON plan object.`;
    return _generateWithRetry(config, spec, feedback, retriesRemaining - 1, systemPrompt);
  }
  const parseResult = PlanSchema.safeParse(parsed);
  if (!parseResult.success) {
    if (retriesRemaining <= 0) {
      throw new Error(`Planner output failed schema validation: ${parseResult.error.message}`);
    }
    const feedback = `${feedbackHistory}\n\nYour JSON didn't match the required schema: ${parseResult.error.message}\nPlease fix and regenerate.`;
    return _generateWithRetry(config, spec, feedback, retriesRemaining - 1, systemPrompt);
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
    if (retriesRemaining <= 0) {
      throw new Error(`Invalid dependency references: ${depErrors.join('; ')}`);
    }
    const feedback = `${feedbackHistory}\n\nInvalid dependency references:\n${depErrors.map(e => `- ${e}`).join('\n')}\nFix these dependency references.`;
    return _generateWithRetry(config, spec, feedback, retriesRemaining - 1, systemPrompt);
  }

  // Auto-fix FIRST: ensure dependency chains are complete before validating
  // This fixes the most common planner mistake: missing dependsOn entries
  _autoFixDependencies(plan);

  // Structural validation: reads/writes consistency, missing deps, circular deps
  // Run after auto-fix — catches issues the auto-fixer can't resolve (circular deps, etc.)
  const structuralIssues = validatePlanStructure(plan);
  if (structuralIssues.length > 0) {
    if (retriesRemaining <= 0) {
      throw new Error(`Plan has structural issues after max retries: ${structuralIssues.join('; ')}`);
    }
    const feedback = `${feedbackHistory}\n\nYour plan has structural issues:\n${structuralIssues.map(i => `- ${i}`).join('\n')}\nFix these issues and regenerate.`;
    return _generateWithRetry(config, spec, feedback, retriesRemaining - 1, systemPrompt);
  }

  return plan;
}

/**
 * Auto-fix dependency chains: if task A reads a file written by task B,
 * ensure A lists B in dependsOn. This catches cases where the LLM planner
 * generates correct reads/writes but forgets to add all dependsOn entries.
 * Also ensures task-001 (scaffold) doesn't write source files by moving
 * any src/*.ts files to the first non-scaffold task.
 */
function _autoFixDependencies(plan: Plan): void {
  // Build writes → taskId map
  const writesMap = new Map<string, string>();
  for (const task of plan.tasks) {
    for (const file of task.writes) {
      writesMap.set(file, task.id);
    }
  }

  // Fix: ensure reads-based dependencies are in dependsOn
  for (const task of plan.tasks) {
    const depsSet = new Set(task.dependsOn);
    for (const readFile of task.reads) {
      const writer = writesMap.get(readFile);
      if (writer && writer !== task.id && !depsSet.has(writer)) {
        task.dependsOn.push(writer);
        depsSet.add(writer);
      }
    }
  }

  // Fix: if scaffold (task-001) writes source files, move them to a new first task
  // or the earliest task that doesn't have conflicting writes
  const scaffold = plan.tasks.find(t => t.id === 'task-001');
  if (scaffold) {
    const sourceFiles = scaffold.writes.filter(f => {
      const isSource = /\.(ts|tsx|js|jsx)$/.test(f) && !/\.config\.(ts|js)$/.test(f);
      const isInSrc = f.startsWith('src/') || f.startsWith('lib/') || f.startsWith('app/');
      return isSource && isInSrc;
    });

    if (sourceFiles.length > 0) {
      // Remove source files from scaffold
      scaffold.writes = scaffold.writes.filter(f => !sourceFiles.includes(f));

      // Find the last task (before tests) and add these files to it
      // or create a new task if needed
      const nonTestTasks = plan.tasks.filter(t =>
        t.id !== 'task-001' &&
        !t.writes.some(f => f.includes('.test.') || f.includes('.spec.'))
      );
      const lastSourceTask = nonTestTasks[nonTestTasks.length - 1];

      if (lastSourceTask) {
        // Add source files to the last source task
        for (const f of sourceFiles) {
          if (!lastSourceTask.writes.includes(f)) {
            lastSourceTask.writes.push(f);
          }
        }
      }
    }
  }
}

/**
 * GSD-inspired project scanner: gives the planner structured understanding of
 * the project before it generates a plan. For greenfield projects, returns null.
 * For brownfield, returns file tree + stack detection + architecture map + export signatures.
 */
async function _detectProjectContext(
  projectDir: string,
): Promise<{ fileTree: string; signatures: string } | null> {
  let files: string[];
  try {
    const { stdout } = await execFileAsync(
      'git', ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: projectDir, timeout: 5_000 },
    );
    files = stdout.trim().split('\n').filter(Boolean);
  } catch {
    return null;
  }

  const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.vue', '.svelte']);
  const sourceFiles = files.filter(f => {
    const ext = f.slice(f.lastIndexOf('.'));
    return sourceExts.has(ext) && !f.includes('node_modules') && !f.startsWith('.anvil/');
  });

  // If fewer than 2 source files, treat as greenfield
  if (sourceFiles.length < 2) return null;

  // --- Stack Detection ---
  let stackInfo = '';
  try {
    const pkg = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const detected: string[] = [];
    if (allDeps.express || allDeps.hono || allDeps.fastify) detected.push(`HTTP: ${allDeps.express ? 'Express' : allDeps.hono ? 'Hono' : 'Fastify'}`);
    if (allDeps.react || allDeps.next) detected.push(`Frontend: ${allDeps.next ? 'Next.js' : 'React'}`);
    if (allDeps.vue) detected.push('Frontend: Vue');
    if (allDeps.zod) detected.push('Validation: Zod');
    if (allDeps.prisma || allDeps['@prisma/client']) detected.push('ORM: Prisma');
    if (allDeps.vitest) detected.push('Testing: Vitest');
    if (allDeps.jest) detected.push('Testing: Jest');
    if (allDeps.typescript) detected.push('Language: TypeScript');
    if (detected.length > 0) stackInfo = `\n### Detected Stack\n${detected.map(d => `- ${d}`).join('\n')}`;
  } catch { /* no package.json */ }

  // --- Architecture Map (directories + file counts) ---
  const dirCounts = new Map<string, number>();
  for (const f of sourceFiles) {
    const dir = f.includes('/') ? f.split('/').slice(0, -1).join('/') : '.';
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }
  const archMap = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([dir, count]) => `  ${dir}/ (${count} files)`)
    .join('\n');

  // --- File Tree (capped at 80 files) ---
  const fileTree = files.slice(0, 80).map(f => `  ${f}`).join('\n');

  // --- Export Signatures (up to 15 files, 8 exports each) ---
  const signatureLines: string[] = [];
  const keyFiles = sourceFiles.slice(0, 15);
  for (const file of keyFiles) {
    try {
      const content = await readFile(join(projectDir, file), 'utf-8');
      const exports = content
        .split('\n')
        .filter(line => /^export\s/.test(line))
        .slice(0, 8)
        .map(line => line.trim().slice(0, 150));
      if (exports.length > 0) {
        signatureLines.push(`#### ${file}`);
        signatureLines.push(...exports.map(e => `  ${e}`));
      }

      // Also extract import patterns to understand dependencies
      const imports = content
        .split('\n')
        .filter(line => /^import\s/.test(line))
        .slice(0, 5)
        .map(line => line.trim().slice(0, 150));
      if (imports.length > 0) {
        signatureLines.push(`  Imports: ${imports.map(i => i.replace(/^import\s+.*from\s+['"](.*)['"].*/, '$1')).join(', ')}`);
      }
    } catch { /* skip */ }
  }

  return {
    fileTree: `### File Tree\n${fileTree}${stackInfo}\n\n### Architecture\n${archMap}`,
    signatures: signatureLines.join('\n') || '(no exports found)',
  };
}
