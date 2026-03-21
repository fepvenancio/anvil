import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SubJudgeReport, SubJudgeCheck } from '../schemas/reports.js';
import type { Task } from '../schemas/plan.js';
import { runTscCheck } from './tsc-judge.js';
import { runVitestCheck } from './vitest-judge.js';
import { runTouchMapCheck } from './touch-map-judge.js';

export async function runSubJudges(
  projectDir: string,
  waveNumber: number,
  tasks: Task[],
  baselineSha: string,
): Promise<SubJudgeReport> {
  const checks: SubJudgeCheck[] = await Promise.all([
    runTscCheck(projectDir),
    runVitestCheck(projectDir),
    runTouchMapCheck(projectDir, baselineSha, tasks),
  ]);

  const report: SubJudgeReport = {
    waveNumber,
    checks,
    allPassed: checks.every(c => c.passed),
    timestamp: new Date().toISOString(),
  };

  // Save report to .anvil/reports/
  const reportsDir = join(projectDir, '.anvil', 'reports');
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    join(reportsDir, `wave-${waveNumber}-judges.json`),
    JSON.stringify(report, null, 2),
  );

  return report;
}
