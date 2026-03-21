import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task } from '../schemas/plan.js';
import type { AnvilConfig } from '../schemas/config.js';
import { validateTouchMap } from '../git/worktree-manager.js';
import { WORKER_SYSTEM_PROMPT } from '../prompts/worker-system.js';

export interface WorkerResult {
  taskId: string;
  success: boolean;
  filesWritten: string[];
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  costUsd?: number;
}

/**
 * Execute a task using Claude Code Agent SDK.
 * Each worker is a full Claude Code agent with file access, bash, iteration.
 * It works in an isolated git worktree and can only touch declared files.
 */
export async function executeTask(
  task: Task,
  worktreePath: string,
  config: AnvilConfig,
  options?: { abortController?: AbortController; retryContext?: string },
): Promise<WorkerResult> {
  // Build the prompt with task details
  let prompt = `## Task: ${task.description}\n\n`;
  prompt += `### Files to create/modify:\n${task.writes.map((f) => `- ${f}`).join('\n')}\n\n`;

  // Phase 2: Inject actual file contents from earlier waves so workers don't guess imports
  if (task.reads.length > 0) {
    prompt += `### Context Files (from earlier waves — your code MUST be compatible with these):\n\n`;
    for (const filePath of task.reads) {
      try {
        const contents = await readFile(join(worktreePath, filePath), 'utf-8');
        prompt += `#### ${filePath}\n\`\`\`\n${contents}\n\`\`\`\n\n`;
      } catch {
        prompt += `#### ${filePath}\n*(file not yet created — will be available at runtime)*\n\n`;
      }
    }
  }

  // Include interface contracts if defined
  if (task.exports && task.exports.length > 0) {
    prompt += `### Interface Contract (your exports MUST match exactly):\n`;
    for (const exp of task.exports) {
      prompt += `- \`${exp.name}\`: \`${exp.type}\`\n`;
    }
    prompt += `\n`;
  }

  prompt += `### Acceptance Criteria:\n${task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}\n\n`;
  prompt += `IMPORTANT: Only create/modify the files listed above. Do not touch any other files.\n`;
  prompt += `Work in the current directory. Do not cd elsewhere.\n`;
  prompt += `After writing files, run \`npx tsc --noEmit\` and \`npx vitest run\` (if applicable) to verify your code compiles and tests pass. Fix any errors before finishing.\n`;

  if (options?.retryContext) {
    prompt += `\n### Previous Attempt Failed\n${options.retryContext}\n\nFix these issues in your implementation. Do NOT repeat the same mistakes.\n`;
  }

  try {
    const conversation = query({
      prompt,
      options: {
        cwd: worktreePath,
        systemPrompt: WORKER_SYSTEM_PROMPT,
        model: config.model,
        maxTurns: 15,
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        abortController: options?.abortController,
        tools: { type: 'preset', preset: 'claude_code' },
        // Inherit parent environment — Claude Code, Gemini CLI, etc. provide auth automatically
      },
    });

    // Consume the async generator, collect the result
    let resultMessage: any = null;
    for await (const message of conversation) {
      if (message.type === 'result') {
        resultMessage = message;
      }
    }

    if (!resultMessage || resultMessage.subtype === 'error') {
      return {
        taskId: task.id,
        success: false,
        filesWritten: [],
        error: resultMessage?.result ?? 'Claude Code agent returned no result',
      };
    }

    // Check touch map — report extra files but don't block
    // Claude Code agents are creative and may create helpful extra files.
    // The Sub-Judge touch-map check is the real enforcement layer.
    const touchResult = await validateTouchMap(worktreePath, task.writes);
    const actualFiles = touchResult.valid
      ? task.writes
      : [...task.writes, ...touchResult.violations];

    return {
      taskId: task.id,
      success: true,
      filesWritten: actualFiles,
      costUsd: resultMessage.total_cost_usd,
      usage: resultMessage.usage ? {
        input_tokens: resultMessage.usage.input_tokens ?? 0,
        output_tokens: resultMessage.usage.output_tokens ?? 0,
        cache_creation_input_tokens: resultMessage.usage.cache_creation_input_tokens,
        cache_read_input_tokens: resultMessage.usage.cache_read_input_tokens,
      } : undefined,
    };
  } catch (err) {
    return {
      taskId: task.id,
      success: false,
      filesWritten: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
