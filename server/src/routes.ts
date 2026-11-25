import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { HttpError, type TaskStore } from './db.js';
import type { EventBus } from './events.js';
import {
  COLUMNS,
  PRIORITIES,
  type EditTaskInput,
  type NewTaskInput,
  type ReorderInput,
  type TaskPriority,
  type TaskStatus,
} from './types.js';

export type ServerConfig = {
  failureInjectionEnabled: boolean;
  failureInjectionRate: number;
  allowFailureHeader: boolean;
};

function isStatus(val: unknown): val is TaskStatus {
  return typeof val === 'string' && (COLUMNS as readonly string[]).includes(val);
}

function isPriority(val: unknown): val is TaskPriority {
  return typeof val === 'string' && (PRIORITIES as readonly string[]).includes(val);
}

function parseCreate(body: Record<string, unknown>): NewTaskInput {
  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Title is required.');
  }
  if (body.title.trim().length > 200) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Title must be 200 characters or fewer.');
  }
  if (!isPriority(body.priority)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Priority must be low, medium, or high.');
  }
  if (!isStatus(body.status)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Status must be one of the four columns.');
  }
  if (body.description !== undefined && typeof body.description !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Description must be a string.');
  }
  if (body.assignee !== undefined && typeof body.assignee !== 'string') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Assignee must be a string.');
  }
  if (
    body.position !== undefined &&
    (typeof body.position !== 'number' || !Number.isInteger(body.position) || body.position < 0)
  ) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Position must be a non-negative integer.');
  }

  return {
    title: body.title,
    description: body.description ?? '',
    priority: body.priority,
    assignee: body.assignee ?? '',
    status: body.status,
    ...(body.position !== undefined ? { position: body.position } : {}),
  };
}

function parseUpdate(body: Record<string, unknown>): EditTaskInput {
  const input: EditTaskInput = {};

  if (body.title !== undefined) {
    if (typeof body.title !== 'string' || body.title.trim().length === 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Title cannot be empty.');
    }
    input.title = body.title;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Description must be a string.');
    }
    input.description = body.description;
  }
  if (body.priority !== undefined) {
    if (!isPriority(body.priority)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Priority must be low, medium, or high.');
    }
    input.priority = body.priority;
  }
  if (body.assignee !== undefined) {
    if (typeof body.assignee !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Assignee must be a string.');
    }
    input.assignee = body.assignee;
  }
  if (body.status !== undefined) {
    if (!isStatus(body.status)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid column status.');
    }
    input.status = body.status;
  }
  if (body.position !== undefined) {
    if (typeof body.position !== 'number' || !Number.isInteger(body.position) || body.position < 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Position must be a non-negative integer.');
    }
    input.position = body.position;
  }
  if (typeof body.expectedUpdatedAt === 'string' && body.expectedUpdatedAt.length > 0) {
    input.expectedUpdatedAt = body.expectedUpdatedAt;
  }

  const hasFields =
    input.title !== undefined ||
    input.description !== undefined ||
    input.priority !== undefined ||
    input.assignee !== undefined ||
    input.status !== undefined ||
    input.position !== undefined;

  if (!hasFields) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'No valid fields provided to update.');
  }

  return input;
}

function parseReorder(body: Record<string, unknown>): ReorderInput {
  if (typeof body.taskId !== 'string' || !body.taskId) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'taskId is required.');
  }
  if (!isStatus(body.targetStatus)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid targetStatus.');
  }
  if (
    typeof body.targetPosition !== 'number' ||
    !Number.isInteger(body.targetPosition) ||
    body.targetPosition < 0
  ) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'targetPosition must be a non-negative integer.');
  }

  return {
    taskId: body.taskId,
    targetStatus: body.targetStatus,
    targetPosition: body.targetPosition,
    ...(typeof body.expectedUpdatedAt === 'string'
      ? { expectedUpdatedAt: body.expectedUpdatedAt }
      : {}),
  };
}

function getMeta(req: Request): { clientId: string; mutationId?: string } {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const clientId =
    (typeof body.clientId === 'string' && body.clientId) ||
    req.header('x-client-id') ||
    'anonymous';
  const mutationId =
    (typeof body.mutationId === 'string' && body.mutationId) ||
    req.header('x-mutation-id') ||
    undefined;
  return { clientId, mutationId };
}

export function createApiRouter(store: TaskStore, bus: EventBus, config: ServerConfig): Router {
  const router = Router();
  const mutations = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

  router.use((req, _res, next) => {
    const headerFail =
      config.allowFailureHeader &&
      String(req.header('x-simulate-failure') || '').toLowerCase() === 'true';
    if (headerFail) {
      next(new HttpError(503, 'SIMULATED_FAILURE', 'Simulated failure via X-Simulate-Failure.'));
      return;
    }

    if (config.failureInjectionEnabled && mutations.has(req.method)) {
      const rate = config.failureInjectionRate > 0 ? config.failureInjectionRate : 1;
      if (Math.random() < rate) {
        next(new HttpError(503, 'SIMULATED_FAILURE', 'Simulated failure (FAILURE_INJECTION_ENABLED).'));
        return;
      }
    }
    next();
  });

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      connectedClients: bus.count(),
      failureInjectionEnabled: config.failureInjectionEnabled,
    });
  });

  router.get('/board', (_req, res) => {
    res.json({ tasks: store.getBoard() });
  });

  router.post('/tasks', (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const input = parseCreate(body);
      const { clientId, mutationId } = getMeta(req);
      const { task, affectedTasks } = store.createTask(input);

      bus.emit({ type: 'task.created', task, clientId, mutationId });
      if (affectedTasks.length > 0) {
        bus.emit({
          type: 'task.updated',
          task,
          affectedTasks: [task, ...affectedTasks],
          clientId,
          mutationId,
        });
      }

      res.status(201).json(task);
    } catch (err) {
      next(err);
    }
  });

  router.post('/tasks/reorder', (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const input = parseReorder(body);
      const { clientId, mutationId } = getMeta(req);
      const { task, affectedTasks } = store.reorderTask(input);

      bus.emit({ type: 'task.updated', task, affectedTasks, clientId, mutationId });
      res.json({ task, affectedTasks });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/tasks/:id', (req, res, next) => {
    try {
      const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
      const input = parseUpdate(body);
      const { clientId, mutationId } = getMeta(req);
      const { task, affectedTasks } = store.updateTask(String(req.params.id || ''), input);

      bus.emit({ type: 'task.updated', task, affectedTasks, clientId, mutationId });
      res.json(task);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/tasks/:id', (req, res, next) => {
    try {
      const { clientId, mutationId } = getMeta(req);
      const result = store.deleteTask(String(req.params.id || ''));

      bus.emit({
        type: 'task.deleted',
        taskId: result.id,
        affectedTasks: result.affectedTasks,
        clientId,
        mutationId,
      });
      res.json({ deleted: true, id: result.id });
    } catch (err) {
      next(err);
    }
  });

  router.get('/events', (req, res) => {
    const queryId = typeof req.query.clientId === 'string' ? req.query.clientId.trim() : '';
    const clientId = queryId || req.header('x-client-id') || crypto.randomUUID();
    const cleanup = bus.subscribe(clientId, res);
    req.on('close', cleanup);
  });

  router.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API endpoint not found.' } });
  });

  return router;
}

export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.latestTask ? { latestTask: err.latestTask } : {}),
      },
    });
    return;
  }

  console.error('[server]', err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' },
  });
}
