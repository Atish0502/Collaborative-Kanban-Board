import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './index.js';
import type { Task } from './types.js';

describe('Kanban server API and SSE', () => {
  const cleanups: Array<() => void> = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds sample tasks once on first boot and keeps ordering on restart', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-db-test-'));
    tempDirs.push(tmpDir);
    const dbPath = path.join(tmpDir, 'board.db');

    const app1 = createApp({ dbPath, corsOrigin: '*' });
    const res1 = await request(app1.app).get('/api/board');
    expect(res1.status).toBe(200);
    expect(res1.body.tasks).toHaveLength(7);

    const statuses = res1.body.tasks.map((t: Task) => t.status);
    expect(statuses.indexOf('Backlog')).toBeLessThan(statuses.indexOf('Todo'));
    expect(statuses.indexOf('Todo')).toBeLessThan(statuses.indexOf('In Progress'));
    expect(statuses.indexOf('In Progress')).toBeLessThan(statuses.indexOf('Done'));

    for (const task of res1.body.tasks as Task[]) {
      await request(app1.app).delete(`/api/tasks/${task.id}`);
    }
    app1.close();

    const app2 = createApp({ dbPath, corsOrigin: '*' });
    cleanups.push(app2.close);
    const res2 = await request(app2.app).get('/api/board');
    expect(res2.status).toBe(200);
    expect(res2.body.tasks).toEqual([]);
  });

  it('handles CRUD, validation, and 404 responses', async () => {
    const server = createApp({ dbPath: ':memory:', seed: false, corsOrigin: '*' });
    cleanups.push(server.close);

    const badTitle = await request(server.app).post('/api/tasks').send({
      title: '  ',
      priority: 'high',
      status: 'Todo',
    });
    expect(badTitle.status).toBe(400);

    const badPriority = await request(server.app).post('/api/tasks').send({
      title: 'Ok',
      priority: 'urgent',
      status: 'Todo',
    });
    expect(badPriority.status).toBe(400);

    const badDesc = await request(server.app).post('/api/tasks').send({
      title: 'Ok',
      description: 123,
      priority: 'low',
      status: 'Todo',
    });
    expect(badDesc.status).toBe(400);

    const created = await request(server.app).post('/api/tasks').send({
      title: 'Ship tests',
      description: 'Add API coverage',
      priority: 'high',
      assignee: 'Atish',
      status: 'Todo',
    });
    expect(created.status).toBe(201);
    expect(created.body.position).toBe(0);

    const updated = await request(server.app)
      .patch(`/api/tasks/${created.body.id}`)
      .send({
        title: 'Ship all tests',
        status: 'In Progress',
        expectedUpdatedAt: created.body.updatedAt,
      });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('In Progress');

    const del = await request(server.app).delete(`/api/tasks/${created.body.id}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ deleted: true, id: created.body.id });

    const missing = await request(server.app).delete(`/api/tasks/${created.body.id}`);
    expect(missing.status).toBe(404);
  });

  it('returns 409 conflict on stale expectedUpdatedAt', async () => {
    const server = createApp({ dbPath: ':memory:', seed: false, corsOrigin: '*' });
    cleanups.push(server.close);

    const created = await request(server.app).post('/api/tasks').send({
      title: 'Shared task',
      description: '',
      priority: 'medium',
      assignee: 'Maya',
      status: 'Backlog',
    });

    const first = await request(server.app)
      .patch(`/api/tasks/${created.body.id}`)
      .send({ title: 'First edit', expectedUpdatedAt: created.body.updatedAt });
    expect(first.status).toBe(200);

    const stale = await request(server.app)
      .patch(`/api/tasks/${created.body.id}`)
      .send({ title: 'Stale edit', expectedUpdatedAt: created.body.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.error.latestTask.title).toBe('First edit');
  });

  it('reorders tasks atomically within and across columns', async () => {
    const server = createApp({ dbPath: ':memory:', seed: false, corsOrigin: '*' });
    cleanups.push(server.close);

    const make = (title: string) =>
      request(server.app)
        .post('/api/tasks')
        .send({ title, description: '', priority: 'low', assignee: 'A', status: 'Todo' })
        .then((r) => r.body as Task);

    const t1 = await make('One');
    const t2 = await make('Two');
    const t3 = await make('Three');

    await request(server.app).post('/api/tasks/reorder').send({
      taskId: t3.id,
      targetStatus: 'Todo',
      targetPosition: 0,
    });

    let board = (await request(server.app).get('/api/board')).body.tasks as Task[];
    expect(board.map((t) => t.id)).toEqual([t3.id, t1.id, t2.id]);

    await request(server.app).post('/api/tasks/reorder').send({
      taskId: t1.id,
      targetStatus: 'Done',
      targetPosition: 0,
    });

    board = (await request(server.app).get('/api/board')).body.tasks as Task[];
    expect(board.filter((t) => t.status === 'Todo').map((t) => t.id)).toEqual([t3.id, t2.id]);
    expect(board.filter((t) => t.status === 'Done').map((t) => t.id)).toEqual([t1.id]);
  });

  it('streams task.created, task.updated, and task.deleted over SSE', async () => {
    const server = createApp({ dbPath: ':memory:', seed: false, corsOrigin: '*' });
    cleanups.push(server.close);

    const httpServer = http.createServer(server.app);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const addr = httpServer.address();
    if (!addr || typeof addr === 'string') throw new Error('Bad port');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const ac = new AbortController();
    const res = await fetch(`${baseUrl}/api/events?clientId=tab-listener`, { signal: ac.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    const reading = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split('\n\n');
          buf = frames.pop() || '';
          for (const frame of frames) {
            if (!frame.trim() || frame.startsWith(':')) continue;
            let event = 'message';
            let data = '';
            for (const line of frame.split('\n')) {
              if (line.startsWith('event: ')) event = line.slice(7).trim();
              if (line.startsWith('data: ')) data = line.slice(6).trim();
            }
            if (data) events.push({ event, data: JSON.parse(data) });
          }
        }
      } catch {
        // aborted
      }
    })();

    await new Promise((r) => setTimeout(r, 60));

    const created = await request(server.app).post('/api/tasks').send({
      title: 'Live card',
      description: '',
      priority: 'high',
      assignee: 'Priya',
      status: 'Backlog',
      clientId: 'tab-A',
      mutationId: 'm1',
    });

    await request(server.app).patch(`/api/tasks/${created.body.id}`).send({
      status: 'Todo',
      clientId: 'tab-A',
      mutationId: 'm2',
    });

    await request(server.app)
      .delete(`/api/tasks/${created.body.id}`)
      .set('x-client-id', 'tab-A')
      .set('x-mutation-id', 'm3');

    await new Promise((r) => setTimeout(r, 100));
    ac.abort();
    await reading;
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));

    expect(events.find((e) => e.event === 'task.created')?.data.mutationId).toBe('m1');
    expect(events.find((e) => e.event === 'task.updated')?.data.mutationId).toBe('m2');
    expect(events.find((e) => e.event === 'task.deleted')?.data.taskId).toBe(created.body.id);
  });

  it('rejects requests cleanly when failure injection header is set', async () => {
    const server = createApp({ dbPath: ':memory:', seed: false, corsOrigin: '*' });
    cleanups.push(server.close);

    const res = await request(server.app)
      .post('/api/tasks')
      .set('x-simulate-failure', 'true')
      .send({
        title: 'Fail me',
        description: '',
        priority: 'low',
        assignee: 'Atish',
        status: 'Backlog',
      });

    expect(res.status).toBe(503);
    const board = await request(server.app).get('/api/board');
    expect(board.body.tasks).toEqual([]);
  });
});
