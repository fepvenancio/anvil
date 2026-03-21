import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── System prompt tests ─────────────────────────────────────────────────

describe('high-court system prompt', () => {
  it('exports HIGH_COURT_SYSTEM_PROMPT as a non-empty string', async () => {
    const { HIGH_COURT_SYSTEM_PROMPT } = await import('../../src/prompts/high-court-system.js');
    expect(typeof HIGH_COURT_SYSTEM_PROMPT).toBe('string');
    expect(HIGH_COURT_SYSTEM_PROMPT.length).toBeGreaterThan(200);
  });

  it('contains "architectural review" or "architecture"', async () => {
    const { HIGH_COURT_SYSTEM_PROMPT } = await import('../../src/prompts/high-court-system.js');
    const lower = HIGH_COURT_SYSTEM_PROMPT.toLowerCase();
    expect(lower.includes('architectural review') || lower.includes('architecture')).toBe(true);
  });

  it('mentions all three verdict options: merge, human_required, abort', async () => {
    const { HIGH_COURT_SYSTEM_PROMPT } = await import('../../src/prompts/high-court-system.js');
    expect(HIGH_COURT_SYSTEM_PROMPT).toContain('merge');
    expect(HIGH_COURT_SYSTEM_PROMPT).toContain('human_required');
    expect(HIGH_COURT_SYSTEM_PROMPT).toContain('abort');
  });

  it('instructs checking for circular dependencies', async () => {
    const { HIGH_COURT_SYSTEM_PROMPT } = await import('../../src/prompts/high-court-system.js');
    const lower = HIGH_COURT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('circular');
  });

  it('instructs checking cross-task coherence', async () => {
    const { HIGH_COURT_SYSTEM_PROMPT } = await import('../../src/prompts/high-court-system.js');
    const lower = HIGH_COURT_SYSTEM_PROMPT.toLowerCase();
    expect(lower.includes('cross-task') || lower.includes('coherence')).toBe(true);
  });
});
