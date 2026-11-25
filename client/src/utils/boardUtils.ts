import { COLUMNS, type BoardFilters, type Task, type TaskStatus } from '../types/kanban';

const RANK: Record<TaskStatus, number> = {
  Backlog: 0,
  Todo: 1,
  'In Progress': 2,
  Done: 3,
};

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      RANK[a.status] - RANK[b.status] ||
      a.position - b.position ||
      a.updatedAt.localeCompare(b.updatedAt)
  );
}

export function getTasksByColumn(tasks: Task[], status: TaskStatus): Task[] {
  return sortTasks(tasks.filter((t) => t.status === status));
}

export function filterTasks(tasks: Task[], filters: BoardFilters): Task[] {
  const q = filters.q.trim().toLowerCase();
  return tasks.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q)) return false;
    if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
    if (filters.assignee !== 'all' && t.assignee !== filters.assignee) return false;
    return true;
  });
}

export function hasActiveFilters(filters: BoardFilters): boolean {
  return Boolean(filters.q.trim() || filters.priority !== 'all' || filters.assignee !== 'all');
}

export function getUniqueAssignees(tasks: Task[]): string[] {
  return Array.from(new Set(tasks.map((t) => t.assignee.trim()).filter(Boolean))).sort();
}

export function calculateReorderPlan(allTasks: Task[], activeId: string, overId: string) {
  const active = allTasks.find((t) => t.id === activeId);
  if (!active) return null;

  const isCol = (COLUMNS as readonly string[]).includes(overId);
  const overTask = isCol ? undefined : allTasks.find((t) => t.id === overId);
  if (!isCol && !overTask) return null;

  const targetStatus: TaskStatus = isCol ? (overId as TaskStatus) : overTask!.status;
  const destTasks = getTasksByColumn(allTasks, targetStatus).filter((t) => t.id !== activeId);

  let targetPosition = destTasks.length;
  if (!isCol && overTask) {
    const idx = destTasks.findIndex((t) => t.id === overTask.id);
    if (idx !== -1) {
      if (active.status === targetStatus) {
        const full = getTasksByColumn(allTasks, active.status);
        const oldIdx = full.findIndex((t) => t.id === activeId);
        const overIdx = full.findIndex((t) => t.id === overTask.id);
        targetPosition = oldIdx < overIdx ? idx + 1 : idx;
      } else {
        targetPosition = idx;
      }
    }
  }

  targetPosition = Math.max(0, Math.min(targetPosition, destTasks.length));
  if (active.status === targetStatus && active.position === targetPosition) return null;

  const map = new Map(allTasks.map((t) => [t.id, t]));
  const affected = new Set<string>([activeId]);

  if (active.status !== targetStatus) {
    getTasksByColumn(allTasks, active.status)
      .filter((t) => t.id !== activeId)
      .forEach((t, i) => {
        if (t.position !== i) affected.add(t.id);
        map.set(t.id, { ...t, position: i });
      });
  }

  destTasks.splice(targetPosition, 0, { ...active, status: targetStatus, position: targetPosition });
  destTasks.forEach((t, i) => {
    if (t.id === activeId || t.position !== i) affected.add(t.id);
    map.set(t.id, { ...t, status: targetStatus, position: i });
  });

  return {
    taskId: activeId,
    targetStatus,
    targetPosition,
    optimisticTasks: sortTasks(Array.from(map.values())),
    affectedTaskIds: Array.from(affected),
  };
}
