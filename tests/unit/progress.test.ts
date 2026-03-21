import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProgressDisplay } from '../../src/ui/progress.js';

describe('ProgressDisplay', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  describe('color helpers', () => {
    it('passed() returns string containing the text', () => {
      const p = new ProgressDisplay({ silent: true });
      const result = p.passed('all good');
      expect(result).toContain('all good');
    });

    it('warned() returns string containing the text', () => {
      const p = new ProgressDisplay({ silent: true });
      const result = p.warned('watch out');
      expect(result).toContain('watch out');
    });

    it('failed() returns string containing the text', () => {
      const p = new ProgressDisplay({ silent: true });
      const result = p.failed('broken');
      expect(result).toContain('broken');
    });

    it('info() returns string containing the text', () => {
      const p = new ProgressDisplay({ silent: true });
      const result = p.info('note');
      expect(result).toContain('note');
    });
  });

  describe('wave lifecycle (silent mode)', () => {
    it('waveStart logs wave info', () => {
      const p = new ProgressDisplay({ silent: true });
      p.waveStart(1, 3, 5);
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('Wave 1/3');
      expect(output).toContain('5 tasks');
    });

    it('taskComplete logs green checkmark', () => {
      const p = new ProgressDisplay({ silent: true });
      p.taskComplete(1, 'task-1', 3);
      expect(logSpy).toHaveBeenCalledTimes(1);
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('\u2713');
      expect(output).toContain('task-1');
      expect(output).toContain('3 files');
    });

    it('taskFailed logs red X with error', () => {
      const p = new ProgressDisplay({ silent: true });
      p.taskFailed(1, 'task-2', 'something broke');
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('\u2717');
      expect(output).toContain('task-2');
      expect(output).toContain('something broke');
    });

    it('judgeResult logs passed check', () => {
      const p = new ProgressDisplay({ silent: true });
      p.judgeResult({ name: 'tsc', passed: true });
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('\u2713');
      expect(output).toContain('tsc');
    });

    it('judgeResult logs failed check with message', () => {
      const p = new ProgressDisplay({ silent: true });
      p.judgeResult({ name: 'vitest', passed: false, message: 'tests failed' });
      const output = logSpy.mock.calls[0][0] as string;
      expect(output).toContain('✗');
      expect(output).toContain('vitest');
      expect(output).toContain('tests failed');
    });
  });

  describe('printCompletionSummary', () => {
    it('success banner contains Build Complete and stats', () => {
      const p = new ProgressDisplay({ silent: true });
      p.printCompletionSummary({
        success: true,
        taskCount: 5,
        waveCount: 2,
        verdict: 'merge',
        totalCost: 0.1234,
      });

      const allOutput = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allOutput).toContain('Build Complete');
      expect(allOutput).toContain('5 across 2 wave(s)');
      expect(allOutput).toContain('merge');
      expect(allOutput).toContain('$0.1234');
      expect(allOutput).toContain('Next steps');
      expect(allOutput).toContain('anvil status');
      expect(allOutput).toContain('git push');
    });

    it('failure banner contains Build Failed and failed wave', () => {
      const p = new ProgressDisplay({ silent: true });
      p.printCompletionSummary({
        success: false,
        taskCount: 3,
        waveCount: 2,
        failedAt: 2,
        failedTasks: ['task-3', 'task-4'],
      });

      const allOutput = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allOutput).toContain('Build Failed');
      expect(allOutput).toContain('wave 2');
      expect(allOutput).toContain('task-3');
      expect(allOutput).toContain('Next steps');
    });

    it('human_required banner shows verdict and high court path', () => {
      const p = new ProgressDisplay({ silent: true });
      p.printCompletionSummary({
        success: true,
        taskCount: 4,
        waveCount: 1,
        verdict: 'human_required',
      });

      const allOutput = logSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allOutput).toContain('human_required');
      expect(allOutput).toContain('high-court-report.json');
    });
  });
});
