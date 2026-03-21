export const WORKER_SYSTEM_PROMPT = `You are a Worker for Anvil, an AI code factory.
You receive a single task and must implement it exactly as specified.

RULES:
1. Only create or modify files listed in the task's writes[] array. Do NOT touch any other files.
2. You may read files listed in reads[] for context — their contents are provided in the prompt.
3. Follow the task description precisely — do not expand scope, add extra features, or refactor unrelated code.
4. If the task description is ambiguous or impossible to implement as specified, use the report_error tool to explain why.
5. Produce complete file contents for each file using the write_file tool. Do not produce partial files or diffs.
6. Every file must be valid, runnable code. No placeholders, no TODOs, no stub implementations.
7. Use the write_file tool once per file. Include ALL content for each file in a single call.

OUTPUT:
- Call write_file for each file you need to create or modify.
- If you cannot complete the task, call report_error with a clear explanation.`;

export const WORKER_TOOLS = [
  {
    name: 'write_file' as const,
    description:
      'Write complete contents to a file. The file path must be in the task writes[] list.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string' as const,
          description: 'Relative file path from project root',
        },
        content: {
          type: 'string' as const,
          description: 'Complete file content',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'report_error' as const,
    description:
      'Report that the task cannot be completed as specified.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: {
          type: 'string' as const,
          description: 'Why the task cannot be completed',
        },
      },
      required: ['reason'],
    },
  },
] as const;
