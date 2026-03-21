import { query } from '@anthropic-ai/claude-agent-sdk';
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
  options?: { abortController?: AbortController },
): Promise<WorkerResult> {
  // Build the prompt with task details
  let prompt = `## Task: ${task.description}\n\n`;
  prompt += `### Files to create/modify:\n${task.writes.map((f) => `- ${f}`).join('\n')}\n\n`;
  if (task.reads.length > 0) {
    prompt += `### Files to read for context:\n${task.reads.map((f) => `- ${f}`).join('\n')}\n\n`;
  }
  prompt += `### Acceptance Criteria:\n${task.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}\n\n`;
  prompt += `IMPORTANT: Only create/modify the files listed above. Do not touch any other files.\n`;
  prompt += `Work in the current directory. Do not cd elsewhere.\n`;
  prompt += `If tests are part of the acceptance criteria, run them and fix until they pass.\n`;

  try {
    const conversation = query({
      prompt,
      options: {
        cwd: worktreePath,
        systemPrompt: WORKER_SYSTEM_PROMPT,
        model: config.model,
        maxTurns: 30,
        permissionMode: 'bypassPermissions',
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        abortController: options?.abortController,
        tools: { type: 'preset', preset: 'claude_code' },
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
        },
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

    // Validate touch map — did the agent only modify declared files?
    const touchResult = await validateTouchMap(worktreePath, task.writes);
    if (!touchResult.valid) {
      return {
        taskId: task.id,
        success: false,
        filesWritten: task.writes,
        error: `Touch map violation: files modified outside writes[]: ${touchResult.violations.join(', ')}`,
        costUsd: resultMessage.total_cost_usd,
        usage: resultMessage.usage ? {
          input_tokens: resultMessage.usage.input_tokens ?? 0,
          output_tokens: resultMessage.usage.output_tokens ?? 0,
          cache_creation_input_tokens: resultMessage.usage.cache_creation_input_tokens,
          cache_read_input_tokens: resultMessage.usage.cache_read_input_tokens,
        } : undefined,
      };
    }

    return {
      taskId: task.id,
      success: true,
      filesWritten: task.writes,
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
