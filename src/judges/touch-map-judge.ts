import { simpleGit } from 'simple-git';
import type { SubJudgeCheck } from '../schemas/reports.js';
import type { Task } from '../schemas/plan.js';

// Files/dirs generated as side effects — not intentional writes
const IGNORED_PREFIXES = ['node_modules/', 'dist/', '.anvil/'];
const IGNORED_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  '.gitignore', '.DS_Store', 'tsconfig.tsbuildinfo',
]);

function isGenerated(file: string): boolean {
  if (IGNORED_FILES.has(file)) return true;
  return IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix));
}

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
  const violations = changedFiles.filter(f => !allowedWrites.has(f) && !isGenerated(f));

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
