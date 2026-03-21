import Anthropic from '@anthropic-ai/sdk';
import type { Task } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';
import { validateTouchMap } from '../git/worktree-manager.js';
import { WORKER_SYSTEM_PROMPT, WORKER_TOOLS } from '../prompts/worker-system.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface WorkerResult {
  taskId: string;
  success: boolean;
  filesWritten: string[];
  error?: string;
}

export async function executeTask(
  task: Task,
  worktreePath: string,
  config: AnvilConfig,
  options?: { client?: Anthropic },
): Promise<WorkerResult> {
  const client = options?.client ?? new Anthropic();
  const filesWritten: string[] = [];

  // Build user message with task details and read context
  let userMessage = `## Task: ${task.description}\n\n`;
  userMessage += `### Files to write (writes[]):\n${task.writes.map((f) => `- ${f}`).join('\n')}\n\n`;
  userMessage += `### Files available for context (reads[]):\n${task.reads.map((f) => `- ${f}`).join('\n')}\n\n`;
  userMessage += `### Acceptance Criteria:\n${task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}\n\n`;

  // Read context files from the worktree
  for (const file of task.reads) {
    try {
      const content = await readFile(join(worktreePath, file), 'utf-8');
      userMessage += `### Context: ${file}\n\`\`\`\n${content}\n\`\`\`\n\n`;
    } catch {
      // File doesn't exist yet, skip
    }
  }

  const response = await client.messages.create({
    model: config.model,
    max_tokens: 16384,
    system: WORKER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    tools: WORKER_TOOLS as unknown as Anthropic.Messages.Tool[],
  });

  // Process response content blocks
  for (const block of response.content) {
    if (block.type === 'tool_use') {
      if (block.name === 'write_file') {
        const input = block.input as { path: string; content: string };
        const fullPath = join(worktreePath, input.path);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, input.content);
        filesWritten.push(input.path);
      } else if (block.name === 'report_error') {
        const input = block.input as { reason: string };
        return {
          taskId: task.id,
          success: false,
          filesWritten: [],
          error: input.reason,
        };
      }
    }
  }

  // Validate touch map before reporting success
  const touchResult = await validateTouchMap(worktreePath, task.writes);
  if (!touchResult.valid) {
    return {
      taskId: task.id,
      success: false,
      filesWritten,
      error: `Touch map violation: files modified outside writes[]: ${touchResult.violations.join(', ')}`,
    };
  }

  return {
    taskId: task.id,
    success: true,
    filesWritten,
  };
}
