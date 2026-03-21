import Anthropic from '@anthropic-ai/sdk';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plan } from '../schemas/plan.js';
import type { HighCourtReport } from '../schemas/reports.js';
import type { AnvilConfig } from '../schemas/config.js';
import { LIBRARIAN_SYSTEM_PROMPT } from '../prompts/librarian-system.js';

/** Optional CostTracker interface to avoid hard dependency on cost module. */
interface CostTrackerLike {
  recordFromResponse(
    response: { usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null } },
    agent: string,
    model: string,
    waveNumber?: number,
  ): void;
}

export interface RunLibrarianOptions {
  /** Pre-configured Anthropic client (useful for testing). */
  client?: Anthropic;
  /** Optional cost tracker for recording token usage. */
  costTracker?: CostTrackerLike;
}

/**
 * Generates README.md and ARCHITECTURE.md for the project using AI.
 *
 * Gathers project context (file tree, package.json, High Court report, plan spec),
 * calls Claude twice (once per document), writes the results to projectDir.
 *
 * Does NOT commit — that is handled by the CLI orchestrator.
 */
export async function runLibrarian(
  projectDir: string,
  plan: Plan,
  highCourtReport: HighCourtReport,
  config: AnvilConfig,
  options?: RunLibrarianOptions,
): Promise<{ readmePath: string; architecturePath: string }> {
  const client = options?.client ?? new Anthropic();

  // Gather context: file tree
  const fileTree = await buildFileTree(projectDir);

  // Read package.json if it exists
  let packageJsonContent = '';
  try {
    packageJsonContent = await readFile(join(projectDir, 'package.json'), 'utf-8');
  } catch {
    // No package.json — that's fine
  }

  // Build task descriptions
  const taskDescriptions = plan.tasks
    .map((t) => `- ${t.id}: ${t.description} (writes: ${t.writes.join(', ')})`)
    .join('\n');

  // ── README generation ──

  const readmeUserMessage = `Generate a README.md for this project.

## Project Name
${config.projectName}

## Original Spec
${plan.spec}

## File Tree
${fileTree}

## package.json
${packageJsonContent || '(no package.json found)'}

## High Court Review
Verdict: ${highCourtReport.verdict}
Reasoning: ${highCourtReport.reasoning}
${highCourtReport.concerns.length > 0 ? `Concerns: ${highCourtReport.concerns.join('; ')}` : ''}

## Tasks Completed
${taskDescriptions}`;

  const readmeResponse = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    system: LIBRARIAN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: readmeUserMessage }],
  });

  options?.costTracker?.recordFromResponse(readmeResponse, 'librarian', config.model);

  const readmeContent = extractText(readmeResponse);
  const readmePath = join(projectDir, 'README.md');
  await writeFile(readmePath, readmeContent);

  // ── ARCHITECTURE generation ──

  const invariantSection = highCourtReport.invariantChecks
    .map((c) => `- ${c.name}: ${c.passed ? 'PASSED' : 'FAILED'}${c.detail ? ` — ${c.detail}` : ''}`)
    .join('\n');

  const archUserMessage = `Generate an ARCHITECTURE.md for this project.

## File Tree
${fileTree}

## Tasks and Their File Writes
${taskDescriptions}

## High Court Invariant Checks
${invariantSection}

## High Court Reasoning
${highCourtReport.reasoning}`;

  const archResponse = await client.messages.create({
    model: config.model,
    max_tokens: 4096,
    system: LIBRARIAN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: archUserMessage }],
  });

  options?.costTracker?.recordFromResponse(archResponse, 'librarian', config.model);

  const archContent = extractText(archResponse);
  const architecturePath = join(projectDir, 'ARCHITECTURE.md');
  await writeFile(architecturePath, archContent);

  return { readmePath, architecturePath };
}

/**
 * Build a flat file tree listing, excluding common noise directories.
 */
async function buildFileTree(dir: string, prefix = ''): Promise<string> {
  const EXCLUDE = new Set(['node_modules', '.git', '.anvil', 'dist', '.DS_Store']);
  const lines: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (EXCLUDE.has(entry.name)) continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        lines.push(`${relPath}/`);
        const sub = await buildFileTree(join(dir, entry.name), relPath);
        if (sub) lines.push(sub);
      } else {
        lines.push(relPath);
      }
    }
  } catch {
    // Directory not readable
  }

  return lines.join('\n');
}

/**
 * Extract text content from an Anthropic messages response.
 */
function extractText(response: Anthropic.Messages.Message | { content: Array<{ type: string; text?: string }> }): string {
  return (response.content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text!)
    .join('\n');
}
