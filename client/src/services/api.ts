import type { Task, TaskPriority, TaskStatus } from '../types/kanban';

const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export const apiUrl = (path: string) => `${BASE}${path}`;

export class ApiError extends Error {
  statusCode: number;
  code: string;
  latestTask?: Task;

  constructor(statusCode: number, code: string, message: string, latestTask?: Task) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.latestTask = latestTask;
  }
}

export type RequestMeta = {
  clientId: string;
  mutationId?: string;
  simulateFailure?: boolean;
};

export type CreateTaskPayload = {
  title: string;
  description: string;
  priority: TaskPriority;
  assignee: string;
  status: TaskStatus;
  position?: number;
};

export type UpdateTaskPayload = {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assignee?: string;
  status?: TaskStatus;
  position?: number;
  expectedUpdatedAt?: string;
};

async function apiFetch<T>(path: string, init: RequestInit = {}, meta?: RequestMeta): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (meta?.clientId) headers['X-Client-Id'] = meta.clientId;
  if (meta?.mutationId) headers['X-Mutation-Id'] = meta.mutationId;
  if (meta?.simulateFailure) headers['X-Simulate-Failure'] = 'true';

  const res = await fetch(apiUrl(path), { ...init, headers });
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON response
  }

  if (!res.ok) {
    const err = data?.error as { code?: string; message?: string; latestTask?: Task } | undefined;
    throw new ApiError(
      res.status,
      err?.code || `HTTP_${res.status}`,
      err?.message || `Request failed with status ${res.status}`,
      err?.latestTask
    );
  }
  return data as T;
}

export async function fetchBoard(): Promise<Task[]> {
  const res = await apiFetch<{ tasks: Task[] }>('/api/board', { method: 'GET' });
  return res.tasks;
}

export function createTaskApi(payload: CreateTaskPayload, meta: RequestMeta): Promise<Task> {
  return apiFetch<Task>(
    '/api/tasks',
    { method: 'POST', body: JSON.stringify({ ...payload, clientId: meta.clientId, mutationId: meta.mutationId }) },
    meta
  );
}

export function updateTaskApi(
  id: string,
  payload: UpdateTaskPayload,
  meta: RequestMeta
): Promise<Task> {
  return apiFetch<Task>(
    `/api/tasks/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify({ ...payload, clientId: meta.clientId, mutationId: meta.mutationId }) },
    meta
  );
}

export function reorderTaskApi(
  payload: { taskId: string; targetStatus: TaskStatus; targetPosition: number },
  meta: RequestMeta
): Promise<{ task: Task; affectedTasks: Task[] }> {
  return apiFetch<{ task: Task; affectedTasks: Task[] }>(
    '/api/tasks/reorder',
    { method: 'POST', body: JSON.stringify({ ...payload, clientId: meta.clientId, mutationId: meta.mutationId }) },
    meta
  );
}

export function deleteTaskApi(
  id: string,
  meta: RequestMeta
): Promise<{ deleted: true; id: string }> {
  return apiFetch<{ deleted: true; id: string }>(
    `/api/tasks/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
    meta
  );
}
