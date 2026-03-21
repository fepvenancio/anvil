import { simpleGit } from 'simple-git';
import type { SubJudgeCheck } from '../schemas/reports.js';
import type { Task } from '../schemas/plan.js';

export async function runTouchMapCheck(
  projectDir: string,
  baselineSha: string,
  tasks: Task[],
): Promise<SubJudgeCheck> {
  const git = simpleGit(projectDir);

  const diff = await git.diff(['--name-only', baselineSha, 'HEAD']);
  const changedFiles = diff.split('\n').filter(f => f.length > 0);

  if (changedFiles.length === 0) {
    return { name: 'touch-map', passed: true };
  }

  const allowedWrites = new Set(tasks.flatMap(t => t.writes));
  const violations = changedFiles.filter(f => !allowedWrites.has(f));

  if (violations.length === 0) {
    return { name: 'touch-map', passed: true };
  }

  return {
    name: 'touch-map',
    passed: false,
    message: `${violations.length} file(s) modified outside declared writes[]`,
    details: violations.join('\n'),
  };
}
