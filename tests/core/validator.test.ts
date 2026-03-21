import { describe, it, expect } from 'vitest';
import { validatePlan } from '../../src/core/validator.js';

describe('validatePlan', () => {
  const validPlan = {
    id: 'p1',
    spec: 'Build a REST API',
    tasks: [{
      id: 't1',
      description: 'Create server',
      writes: ['src/index.ts'],
      reads: [],
      dependsOn: [],
      acceptanceCriteria: ['Server starts'],
    }],
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('accepts valid plan and returns parsed data', () => {
    const result = validatePlan(validPlan);
    expect(result.valid).toBe(true);
    expect(result.plan?.id).toBe('p1');
    expect(result.errors).toBeUndefined();
  });

  it('rejects empty object with error messages', () => {
    const result = validatePlan({});
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('rejects non-object input', () => {
    const result = validatePlan('not json');
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it('rejects plan with invalid datetime', () => {
    const result = validatePlan({ ...validPlan, createdAt: 'bad-date' });
    expect(result.valid).toBe(false);
  });

  it('rejects plan with missing task fields', () => {
    const result = validatePlan({
      ...validPlan,
      tasks: [{ id: 't1' }],
    });
    expect(result.valid).toBe(false);
  });
});
