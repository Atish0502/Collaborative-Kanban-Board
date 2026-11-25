import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  apiUrl,
  createTaskApi,
  deleteTaskApi,
  fetchBoard,
  reorderTaskApi,
  updateTaskApi,
  type CreateTaskPayload,
  type UpdateTaskPayload,
} from '../services/api';
import type { BoardSseEvent, ConnectionStatus, Task, ToastMessage } from '../types/kanban';
import { calculateReorderPlan, sortTasks } from '../utils/boardUtils';

type PendingOp = {
  id: string;
  seq: number;
  prevById: Map<string, Task | null>;
};

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

function eventTaskIds(evt: BoardSseEvent): string[] {
  if (evt.type === 'task.created') return [evt.task.id];
  const base = evt.type === 'task.updated' ? evt.task.id : evt.taskId;
  return Array.from(new Set([base, ...(evt.affectedTasks?.map((t) => t.id) ?? [])]));
}

export function useKanbanBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [connectedClients, setConnectedClients] = useState(1);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [simulateFailure, setSimulateFailure] = useState(false);

  const clientId = useRef(uid()).current;
  const tasksRef = useRef<Task[]>([]);
  const seqRef = useRef(0);
  const pendingRef = useRef<Map<string, PendingOp>>(new Map());
  const settledSeqRef = useRef<Map<string, number>>(new Map());
  const deferredRef = useRef<BoardSseEvent[]>([]);
  const connectedOnceRef = useRef(false);
  const failToggleRef = useRef(false);

  useEffect(() => {
    failToggleRef.current = simulateFailure;
  }, [simulateFailure]);

  const updateTasks = useCallback((fn: (prev: Task[]) => Task[]) => {
    setTasks((prev) => {
      const next = sortTasks(fn(prev));
      tasksRef.current = next;
      return next;
    });
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<ToastMessage, 'id'>) => {
      const id = uid();
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismissToast(id), 5000);
    },
    [dismissToast]
  );

  const isLocked = useCallback((taskId: string) => {
    for (const op of pendingRef.current.values()) {
      if (op.prevById.has(taskId)) return true;
    }
    return false;
  }, []);

  const applyEvent = useCallback(
    (evt: BoardSseEvent) => {
      const seq = ++seqRef.current;
      updateTasks((prev) => {
        const map = new Map(prev.map((t) => [t.id, t]));
        if (evt.type === 'task.created') {
          const cur = map.get(evt.task.id);
          if (!cur || evt.task.updatedAt >= cur.updatedAt) {
            map.set(evt.task.id, evt.task);
            settledSeqRef.current.set(evt.task.id, seq);
          }
        } else if (evt.type === 'task.updated') {
          const list = evt.affectedTasks?.length ? evt.affectedTasks : [evt.task];
          for (const item of list) {
            const cur = map.get(item.id);
            if (!cur || item.updatedAt >= cur.updatedAt) {
              map.set(item.id, item);
              settledSeqRef.current.set(item.id, seq);
            }
          }
        } else {
          map.delete(evt.taskId);
          settledSeqRef.current.set(evt.taskId, seq);
          for (const item of evt.affectedTasks ?? []) {
            const cur = map.get(item.id);
            if (cur && item.updatedAt >= cur.updatedAt) {
              map.set(item.id, item);
              settledSeqRef.current.set(item.id, seq);
            }
          }
        }
        return Array.from(map.values());
      });
    },
    [updateTasks]
  );

  const flushDeferred = useCallback(() => {
    if (!deferredRef.current.length) return;
    const keep: BoardSseEvent[] = [];
    for (const evt of deferredRef.current) {
      if (eventTaskIds(evt).some((id) => isLocked(id))) keep.push(evt);
      else applyEvent(evt);
    }
    deferredRef.current = keep;
  }, [applyEvent, isLocked]);

  const loadBoard = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setLoadError(null);
      try {
        const fresh = await fetchBoard();
        updateTasks((prev) => {
          if (!pendingRef.current.size) return fresh;
          // Preserve locally edited cards if a reconnect happens mid-flight
          const merged = new Map(fresh.map((t) => [t.id, t]));
          for (const t of prev) if (isLocked(t.id)) merged.set(t.id, t);
          return Array.from(merged.values());
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to load the board.';
        setLoadError(msg);
        if (!silent) {
          addToast({
            variant: 'error',
            title: 'Failed to load board',
            description: msg,
            retryAction: () => void loadBoard(),
          });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [addToast, isLocked, updateTasks]
  );

  useEffect(() => {
    void loadBoard();

    const es = new EventSource(apiUrl(`/api/events?clientId=${encodeURIComponent(clientId)}`));

    es.onopen = () => {
      setConnectionStatus('connected');
      if (connectedOnceRef.current) void loadBoard(true);
      connectedOnceRef.current = true;
    };

    es.onerror = () => setConnectionStatus('reconnecting');

    const readCount = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { connectedClients?: number };
        if (typeof data.connectedClients === 'number') setConnectedClients(data.connectedClients);
      } catch {
        // ignore
      }
    };

    const onBoardEvent = (e: MessageEvent) => {
      try {
        const evt = JSON.parse(e.data) as BoardSseEvent;
        if (evt.clientId === clientId) return; // skip self-events
        if (eventTaskIds(evt).some((id) => isLocked(id))) deferredRef.current.push(evt);
        else applyEvent(evt);
      } catch {
        // ignore
      }
    };

    es.addEventListener('connected', readCount);
    es.addEventListener('clients.count', readCount);
    es.addEventListener('task.created', onBoardEvent);
    es.addEventListener('task.updated', onBoardEvent);
    es.addEventListener('task.deleted', onBoardEvent);

    return () => es.close();
  }, [applyEvent, clientId, isLocked, loadBoard]);

  const startOp = useCallback((ids: string[]): PendingOp => {
    const id = uid();
    const seq = ++seqRef.current;
    const prevById = new Map<string, Task | null>();
    for (const taskId of ids) {
      prevById.set(taskId, tasksRef.current.find((t) => t.id === taskId) ?? null);
    }
    const op = { id, seq, prevById };
    pendingRef.current.set(id, op);
    return op;
  }, []);

  const rollbackOp = useCallback(
    (op: PendingOp) => {
      pendingRef.current.delete(op.id);
      updateTasks((prev) => {
        const map = new Map(prev.map((t) => [t.id, t]));
        for (const [taskId, oldTask] of op.prevById) {
          // Skip rollback if a newer edit already won for this task
          if (isLocked(taskId) || (settledSeqRef.current.get(taskId) ?? 0) > op.seq) continue;
          if (oldTask === null) map.delete(taskId);
          else map.set(taskId, oldTask);
        }
        return Array.from(map.values());
      });
      flushDeferred();
    },
    [flushDeferred, isLocked, updateTasks]
  );

  const metaFor = (mutationId: string) => ({
    clientId,
    mutationId,
    simulateFailure: failToggleRef.current,
  });

  const createTask = useCallback(
    async (payload: CreateTaskPayload): Promise<Task> => {
      const tempId = `temp-${uid()}`;
      const optimistic: Task = {
        id: tempId,
        title: payload.title.trim(),
        description: payload.description,
        priority: payload.priority,
        assignee: payload.assignee.trim(),
        status: payload.status,
        position: tasksRef.current.filter((t) => t.status === payload.status).length,
        updatedAt: new Date().toISOString(),
      };
      const op = startOp([tempId]);
      updateTasks((prev) => [...prev, optimistic]);

      try {
        const created = await createTaskApi(payload, metaFor(op.id));
        pendingRef.current.delete(op.id);
        settledSeqRef.current.set(created.id, op.seq);
        updateTasks((prev) => prev.map((t) => (t.id === tempId ? created : t)));
        flushDeferred();
        addToast({
          variant: 'success',
          title: 'Task created',
          description: `"${created.title}" added to ${created.status}.`,
        });
        return created;
      } catch (err) {
        rollbackOp(op);
        const msg = err instanceof Error ? err.message : 'Failed to create task.';
        addToast({
          variant: 'error',
          title: 'Could not create task',
          description: `${msg} Changes were rolled back.`,
        });
        throw err;
      }
    },
    [addToast, flushDeferred, rollbackOp, startOp, updateTasks]
  );

  const updateTask = useCallback(
    async (id: string, payload: UpdateTaskPayload): Promise<Task> => {
      const op = startOp([id]);
      updateTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                title: payload.title !== undefined ? payload.title.trim() : t.title,
                description: payload.description ?? t.description,
                priority: payload.priority ?? t.priority,
                assignee: payload.assignee !== undefined ? payload.assignee.trim() : t.assignee,
                status: payload.status ?? t.status,
              }
            : t
        )
      );

      try {
        const updated = await updateTaskApi(id, payload, metaFor(op.id));
        pendingRef.current.delete(op.id);
        settledSeqRef.current.set(updated.id, op.seq);
        if (!isLocked(id)) updateTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
        flushDeferred();
        addToast({ variant: 'success', title: 'Task updated', description: `"${updated.title}" saved.` });
        return updated;
      } catch (err) {
        rollbackOp(op);
        if (err instanceof ApiError && err.statusCode === 409 && err.latestTask) {
          const latest = err.latestTask;
          updateTasks((prev) => prev.map((t) => (t.id === latest.id ? latest : t)));
          addToast({
            variant: 'warning',
            title: 'Concurrent edit conflict',
            description: 'Someone else saved changes to this task first.',
          });
        } else {
          const msg = err instanceof Error ? err.message : 'Failed to update task.';
          addToast({
            variant: 'error',
            title: 'Could not update task',
            description: `${msg} Changes were rolled back.`,
          });
        }
        throw err;
      }
    },
    [addToast, flushDeferred, isLocked, rollbackOp, startOp, updateTasks]
  );

  const deleteTask = useCallback(
    async (id: string): Promise<void> => {
      const target = tasksRef.current.find((t) => t.id === id);
      if (!target) return;

      const siblings = tasksRef.current
        .filter((t) => t.status === target.status && t.id !== id)
        .map((t) => t.id);
      const op = startOp([id, ...siblings]);

      updateTasks((prev) => {
        let pos = 0;
        return prev
          .filter((t) => t.id !== id)
          .map((t) => (t.status === target.status ? { ...t, position: pos++ } : t));
      });

      try {
        await deleteTaskApi(id, metaFor(op.id));
        pendingRef.current.delete(op.id);
        settledSeqRef.current.set(id, op.seq);
        flushDeferred();
        addToast({ variant: 'success', title: 'Task deleted', description: `"${target.title}" removed.` });
      } catch (err) {
        rollbackOp(op);
        const msg = err instanceof Error ? err.message : 'Failed to delete task.';
        addToast({
          variant: 'error',
          title: 'Could not delete task',
          description: `${msg} Task restored.`,
        });
        throw err;
      }
    },
    [addToast, flushDeferred, rollbackOp, startOp, updateTasks]
  );

  const moveTask = useCallback(
    async (activeId: string, overId: string): Promise<void> => {
      const plan = calculateReorderPlan(tasksRef.current, activeId, overId);
      if (!plan) return;

      const op = startOp(plan.affectedTaskIds);
      updateTasks(() => plan.optimisticTasks);

      try {
        const res = await reorderTaskApi(
          { taskId: plan.taskId, targetStatus: plan.targetStatus, targetPosition: plan.targetPosition },
          metaFor(op.id)
        );
        pendingRef.current.delete(op.id);
        updateTasks((prev) => {
          const map = new Map(prev.map((t) => [t.id, t]));
          for (const t of res.affectedTasks) {
            settledSeqRef.current.set(t.id, op.seq);
            if (!isLocked(t.id)) map.set(t.id, t);
          }
          return Array.from(map.values());
        });
        flushDeferred();
      } catch (err) {
        rollbackOp(op);
        const msg = err instanceof Error ? err.message : 'Could not save new order.';
        addToast({
          variant: 'error',
          title: 'Drag-and-drop failed',
          description: `${msg} Previous ordering restored.`,
        });
      }
    },
    [addToast, flushDeferred, isLocked, rollbackOp, startOp, updateTasks]
  );

  return {
    tasks,
    isLoading,
    loadError,
    connectionStatus,
    connectedClients,
    toasts,
    simulateFailure,
    setSimulateFailure,
    dismissToast,
    reloadBoard: () => loadBoard(),
    createTask,
    updateTask,
    deleteTask,
    moveTask,
  };
}
