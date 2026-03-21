import type { Task } from '../schemas/plan.js';
import type { Wave } from '../schemas/wave.js';

/**
 * Validates that all dependsOn references point to existing task IDs.
 * Returns an array of error strings (empty if all refs are valid).
 */
export function validateDependencyRefs(tasks: Task[]): string[] {
  const taskIds = new Set(tasks.map((t) => t.id));
  const errors: string[] = [];

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!taskIds.has(dep)) {
        errors.push(
          `Task "${task.id}" depends on "${dep}" which does not exist`,
        );
      }
    }
  }

  return errors;
}

/**
 * Topologically sorts tasks by their dependsOn fields using Kahn's algorithm.
 * Throws if a dependency cycle is detected.
 */
export function topologicalSort(tasks: Task[]): Task[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map(tasks.map((t) => [t.id, 0]));
  const adjList = new Map<string, string[]>();

  for (const task of tasks) {
    adjList.set(task.id, []);
  }

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      adjList.get(dep)?.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const sorted: Task[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(taskMap.get(id)!);
    for (const neighbor of adjList.get(id) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length !== tasks.length) {
    const remaining = tasks
      .filter((t) => !sorted.some((s) => s.id === t.id))
      .map((t) => t.id);
    throw new Error(
      `Dependency cycle detected among tasks: ${remaining.join(', ')}`,
    );
  }

  return sorted;
}

/**
 * Groups tasks into waves by BFS level in the dependency DAG.
 * Tasks with no unresolved dependencies are in wave 1, tasks whose
 * dependencies are all in wave 1 are in wave 2, etc.
 * Throws if a dependency cycle is detected.
 */
export function topologicalWaves(tasks: Task[]): Wave[] {
  if (tasks.length === 0) return [];

  const inDegree = new Map(tasks.map((t) => [t.id, 0]));
  const adjList = new Map<string, string[]>();

  for (const task of tasks) {
    adjList.set(task.id, []);
  }

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      adjList.get(dep)?.push(task.id);
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
    }
  }

  // Seed with all zero-degree nodes
  let currentLevel: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) currentLevel.push(id);
  }

  const waves: Wave[] = [];
  let totalScheduled = 0;

  while (currentLevel.length > 0) {
    currentLevel.sort(); // deterministic ordering within wave
    waves.push({
      waveNumber: waves.length + 1,
      taskIds: [...currentLevel],
      status: 'pending',
    });
    totalScheduled += currentLevel.length;

    const nextLevel: string[] = [];
    for (const id of currentLevel) {
      for (const neighbor of adjList.get(id) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) nextLevel.push(neighbor);
      }
    }
    currentLevel = nextLevel;
  }

  if (totalScheduled !== tasks.length) {
    const remaining = tasks
      .filter((t) => !waves.some((w) => w.taskIds.includes(t.id)))
      .map((t) => t.id);
    throw new Error(
      `Dependency cycle detected among tasks: ${remaining.join(', ')}`,
    );
  }

  return waves;
}
