import { query } from '@anthropic-ai/claude-agent-sdk';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plan } from '../schemas/plan.js';
import type { HighCourtReport } from '../schemas/reports.js';
import type { AnvilConfig } from '../schemas/config.js';
import { LIBRARIAN_SYSTEM_PROMPT } from '../prompts/librarian-system.js';

/**
 * Generates README.md and ARCHITECTURE.md for the project using Claude Code Agent SDK.
 * Auth is inherited from the parent CLI environment.
 *
 * Does NOT commit — that is handled by the CLI orchestrator.
 */
export async function runLibrarian(
  projectDir: string,
  plan: Plan,
  highCourtReport: HighCourtReport,
  config: AnvilConfig,
): Promise<{ readmePath: string; architecturePath: string }> {
  // Gather context
  const fileTree = await buildFileTree(projectDir);
  let packageJsonContent = '';
  try {
    packageJsonContent = await readFile(join(projectDir, 'package.json'), 'utf-8');
  } catch {
    // No package.json
  }

  const taskDescriptions = plan.tasks
    .map((t) => `- ${t.id}: ${t.description} (writes: ${t.writes.join(', ')})`)
    .join('\n');

  // ── README generation ──
  const readmePrompt = `Generate a README.md for this project. Return ONLY the markdown content, no code fences.

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

  const readmeConv = query({
    prompt: readmePrompt,
    options: {
      systemPrompt: LIBRARIAN_SYSTEM_PROMPT,
      model: config.model,
      maxTurns: 2,
      permissionMode: 'bypassPermissions',
      tools: [],
    },
  });

  let readmeContent = '';
  for await (const message of readmeConv) {
    if (message.type === 'result' && message.subtype === 'success') {
      readmeContent = message.result;
    }
  }

  const readmePath = join(projectDir, 'README.md');
  await writeFile(readmePath, readmeContent);

  // ── ARCHITECTURE generation ──
  const invariantSection = highCourtReport.invariantChecks
    .map((c) => `- ${c.name}: ${c.passed ? 'PASSED' : 'FAILED'}${c.detail ? ` — ${c.detail}` : ''}`)
    .join('\n');

  const archPrompt = `Generate an ARCHITECTURE.md for this project. Return ONLY the markdown content, no code fences.

## File Tree
${fileTree}

## Tasks and Their File Writes
${taskDescriptions}

## High Court Invariant Checks
${invariantSection}

## High Court Reasoning
${highCourtReport.reasoning}`;

  const archConv = query({
    prompt: archPrompt,
    options: {
      systemPrompt: LIBRARIAN_SYSTEM_PROMPT,
      model: config.model,
      maxTurns: 2,
      permissionMode: 'bypassPermissions',
      tools: [],
    },
  });

  let archContent = '';
  for await (const message of archConv) {
    if (message.type === 'result' && message.subtype === 'success') {
      archContent = message.result;
    }
  }

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
