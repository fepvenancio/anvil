import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export async function initAnvilDir(root: string): Promise<string> {
  const anvilDir = join(root, '.anvil');
  const dirs = ['logs', 'reports', 'history', 'worktrees'];

  for (const dir of dirs) {
    await mkdir(join(anvilDir, dir), { recursive: true });
  }

  const roadmapPath = join(anvilDir, 'roadmap.json');
  try {
    await access(roadmapPath);
  } catch {
    await writeFile(roadmapPath, JSON.stringify({ plan: null }, null, 2));
  }

  return anvilDir;
}
