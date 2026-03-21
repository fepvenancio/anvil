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

  // Read actual source files so docs describe what was BUILT, not just planned
  const sourceSnippets = await readSourceFiles(projectDir, plan);

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
${taskDescriptions}

## Source Code (actual implementation)
${sourceSnippets}`;

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
${highCourtReport.reasoning}

## Source Code (actual implementation)
${sourceSnippets}`;

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
 * Read source files that tasks wrote, so the Librarian documents actual code, not just plans.
 * Returns a markdown string with file contents (truncated for context window).
 */
async function readSourceFiles(projectDir: string, plan: Plan): Promise<string> {
  const sourceExts = new Set(['.ts', '.tsx', '.js', '.jsx']);
  const configExts = new Set(['.config.ts', '.config.js', '.config.mts']);
  const lines: string[] = [];
  let totalChars = 0;
  const MAX_CHARS = 20_000; // Cap to avoid blowing context window

  for (const task of plan.tasks) {
    for (const file of task.writes) {
      const ext = file.slice(file.lastIndexOf('.'));
      if (!sourceExts.has(ext)) continue;
      if (configExts.has(file.slice(file.lastIndexOf('/')))) continue;

      try {
        let content = await readFile(join(projectDir, file), 'utf-8');
        if (totalChars + content.length > MAX_CHARS) {
          content = content.slice(0, MAX_CHARS - totalChars) + '\n// ... truncated';
        }
        lines.push(`### ${file}\n\`\`\`typescript\n${content}\n\`\`\`\n`);
        totalChars += content.length;
        if (totalChars >= MAX_CHARS) break;
      } catch {
        // File doesn't exist
      }
    }
    if (totalChars >= MAX_CHARS) break;
  }

  return lines.length > 0 ? lines.join('\n') : '(no source files found)';
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
