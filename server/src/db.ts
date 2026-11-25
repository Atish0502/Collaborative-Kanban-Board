import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  EditTaskInput,
  NewTaskInput,
  ReorderInput,
  Task,
  TaskPriority,
  TaskStatus,
} from './types.js';

type Row = {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  assignee: string;
  status: TaskStatus;
  position: number;
  updated_at: string;
};

export class HttpError extends Error {
  status: number;
  code: string;
  latestTask?: Task;

  constructor(status: number, code: string, message: string, latestTask?: Task) {
    super(message);
    this.status = status;
    this.code = code;
    this.latestTask = latestTask;
  }
}

const SAMPLE_TASKS: Array<Omit<Task, 'id' | 'updatedAt'>> = [
  {
    title: 'Design API rate-limiting middleware',
    description: 'Set per-workspace thresholds and return standard Retry-After headers.',
    priority: 'medium',
    assignee: 'Atish',
    status: 'Backlog',
    position: 0,
  },
  {
    title: 'Add keyboard shortcut cheatsheet modal',
    description: 'Press ? to view search and quick-create shortcuts.',
    priority: 'low',
    assignee: 'Maya',
    status: 'Backlog',
    position: 1,
  },
  {
    title: 'Implement OAuth PKCE callback handler',
    description: 'Check state nonce, exchange auth code for tokens, and save refresh token.',
    priority: 'high',
    assignee: 'Rohan',
    status: 'Todo',
    position: 0,
  },
  {
    title: 'Audit SQLite query plans for board loads',
    description: 'Check index usage on (status, position) with EXPLAIN QUERY PLAN.',
    priority: 'medium',
    assignee: 'Atish',
    status: 'Todo',
    position: 1,
  },
  {
    title: 'Build real-time SSE conflict reconciliation',
    description: 'Queue remote updates during local saves and show 409 conflict prompts.',
    priority: 'high',
    assignee: 'Priya',
    status: 'In Progress',
    position: 0,
  },
  {
    title: 'Refine drag-and-drop column drop targets',
    description: 'Make sure cards drop cleanly into empty or filtered columns.',
    priority: 'medium',
    assignee: 'Maya',
    status: 'In Progress',
    position: 1,
  },
  {
    title: 'Configure CI typecheck and Vitest suite',
    description: 'Run server and client tests before building.',
    priority: 'low',
    assignee: 'Rohan',
    status: 'Done',
    position: 0,
  },
];

function toTask(row: Row): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    assignee: row.assignee,
    status: row.status,
    position: row.position,
    updatedAt: row.updated_at,
  };
}

// Keep timestamps strictly increasing even if two edits happen in the same millisecond.
function bumpTimestamp(prev?: string): string {
  const now = Date.now();
  if (!prev) return new Date(now).toISOString();
  const prevMs = Date.parse(prev);
  return Number.isFinite(prevMs) && now <= prevMs
    ? new Date(prevMs + 1).toISOString()
    : new Date(now).toISOString();
}

export function openDatabase(dbPath: string, seed = true): Database.Database {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }

  const db = new Database(dbPath);
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
      assignee TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('Backlog', 'Todo', 'In Progress', 'Done')),
      position INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status_position ON tasks (status, position);
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  if (seed) {
    db.transaction(() => {
      const done = db.prepare('SELECT value FROM app_metadata WHERE key = ?').get('seeded');
      if (done) return;

      const { count } = db.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number };
      if (count === 0) {
        const stmt = db.prepare(`
          INSERT INTO tasks (id, title, description, priority, assignee, status, position, updated_at)
          VALUES (@id, @title, @description, @priority, @assignee, @status, @position, @updated_at)
        `);
        const now = new Date().toISOString();
        for (const item of SAMPLE_TASKS) {
          stmt.run({ ...item, id: crypto.randomUUID(), updated_at: now });
        }
      }

      db.prepare('INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)').run(
        'seeded',
        new Date().toISOString()
      );
    })();
  }

  return db;
}

export class TaskStore {
  constructor(private db: Database.Database) {}

  getBoard(): Task[] {
    const rows = this.db
      .prepare(`
        SELECT id, title, description, priority, assignee, status, position, updated_at
        FROM tasks
        ORDER BY
          CASE status
            WHEN 'Backlog' THEN 1
            WHEN 'Todo' THEN 2
            WHEN 'In Progress' THEN 3
            WHEN 'Done' THEN 4
          END ASC,
          position ASC,
          updated_at ASC
      `)
      .all() as Row[];
    return rows.map(toTask);
  }

  private getById(id: string): Task | null {
    const row = this.db
      .prepare(
        'SELECT id, title, description, priority, assignee, status, position, updated_at FROM tasks WHERE id = ?'
      )
      .get(id) as Row | undefined;
    return row ? toTask(row) : null;
  }

  private getColumn(status: TaskStatus): Task[] {
    const rows = this.db
      .prepare(
        'SELECT id, title, description, priority, assignee, status, position, updated_at FROM tasks WHERE status = ? ORDER BY position ASC, updated_at ASC'
      )
      .all(status) as Row[];
    return rows.map(toTask);
  }

  createTask(input: NewTaskInput): { task: Task; affectedTasks: Task[] } {
    return this.db.transaction(() => {
      const col = this.getColumn(input.status);
      const pos =
        input.position !== undefined
          ? Math.max(0, Math.min(input.position, col.length))
          : col.length;

      const task: Task = {
        id: crypto.randomUUID(),
        title: input.title.trim(),
        description: input.description,
        priority: input.priority,
        assignee: input.assignee.trim(),
        status: input.status,
        position: pos,
        updatedAt: bumpTimestamp(),
      };

      const affected: Task[] = [];
      const shift = this.db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
      for (let i = pos; i < col.length; i++) {
        shift.run(i + 1, col[i].id);
        affected.push({ ...col[i], position: i + 1 });
      }

      this.db
        .prepare(
          'INSERT INTO tasks (id, title, description, priority, assignee, status, position, updated_at) VALUES (@id, @title, @description, @priority, @assignee, @status, @position, @updated_at)'
        )
        .run({
          id: task.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          assignee: task.assignee,
          status: task.status,
          position: task.position,
          updated_at: task.updatedAt,
        });

      return { task, affectedTasks: affected };
    })();
  }

  updateTask(id: string, input: EditTaskInput): { task: Task; affectedTasks: Task[] } {
    return this.db.transaction(() => {
      const current = this.getById(id);
      if (!current) throw new HttpError(404, 'NOT_FOUND', `Task "${id}" not found.`);

      if (input.expectedUpdatedAt && current.updatedAt !== input.expectedUpdatedAt) {
        throw new HttpError(
          409,
          'CONFLICT',
          'This task was updated by someone else while you were editing.',
          current
        );
      }

      const nextStatus = input.status ?? current.status;
      const updatedAt = bumpTimestamp(current.updatedAt);

      this.db
        .prepare(
          'UPDATE tasks SET title = ?, description = ?, priority = ?, assignee = ?, updated_at = ? WHERE id = ?'
        )
        .run(
          input.title !== undefined ? input.title.trim() : current.title,
          input.description !== undefined ? input.description : current.description,
          input.priority ?? current.priority,
          input.assignee !== undefined ? input.assignee.trim() : current.assignee,
          updatedAt,
          id
        );

      const needsMove =
        nextStatus !== current.status ||
        (input.position !== undefined && input.position !== current.position);

      if (needsMove) {
        const targetCol = this.getColumn(nextStatus).filter((t) => t.id !== id);
        const pos =
          input.position !== undefined
            ? Math.max(0, Math.min(input.position, targetCol.length))
            : targetCol.length;
        return this.moveInTx(id, nextStatus, pos, updatedAt);
      }

      const updated = this.getById(id)!;
      return { task: updated, affectedTasks: [updated] };
    })();
  }

  reorderTask(input: ReorderInput): { task: Task; affectedTasks: Task[] } {
    return this.db.transaction(() => {
      const current = this.getById(input.taskId);
      if (!current) throw new HttpError(404, 'NOT_FOUND', `Task "${input.taskId}" not found.`);

      if (input.expectedUpdatedAt && current.updatedAt !== input.expectedUpdatedAt) {
        throw new HttpError(
          409,
          'CONFLICT',
          'This task was moved or edited by another user.',
          current
        );
      }

      return this.moveInTx(
        input.taskId,
        input.targetStatus,
        input.targetPosition,
        bumpTimestamp(current.updatedAt)
      );
    })();
  }

  deleteTask(id: string): { id: string; affectedTasks: Task[] } {
    return this.db.transaction(() => {
      const current = this.getById(id);
      if (!current) throw new HttpError(404, 'NOT_FOUND', `Task "${id}" not found.`);

      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);

      const remaining = this.getColumn(current.status);
      const stmt = this.db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
      const affected: Task[] = [];
      remaining.forEach((t, idx) => {
        if (t.position !== idx) {
          stmt.run(idx, t.id);
          affected.push({ ...t, position: idx });
        }
      });

      return { id, affectedTasks: affected };
    })();
  }

  private moveInTx(
    taskId: string,
    targetStatus: TaskStatus,
    targetPosition: number,
    updatedAt: string
  ): { task: Task; affectedTasks: Task[] } {
    const task = this.getById(taskId)!;
    const sourceStatus = task.status;
    const updateMoved = this.db.prepare(
      'UPDATE tasks SET status = ?, position = ?, updated_at = ? WHERE id = ?'
    );
    const updatePos = this.db.prepare('UPDATE tasks SET position = ? WHERE id = ?');
    const changed = new Map<string, Task>();

    if (sourceStatus !== targetStatus) {
      this.getColumn(sourceStatus)
        .filter((t) => t.id !== taskId)
        .forEach((t, idx) => {
          if (t.position !== idx) {
            updatePos.run(idx, t.id);
            changed.set(t.id, { ...t, position: idx });
          }
        });
    }

    const dest = this.getColumn(targetStatus).filter((t) => t.id !== taskId);
    const pos = Math.max(0, Math.min(targetPosition, dest.length));
    dest.splice(pos, 0, { ...task, status: targetStatus, position: pos, updatedAt });

    dest.forEach((t, idx) => {
      if (t.id === taskId) {
        updateMoved.run(targetStatus, idx, updatedAt, taskId);
        changed.set(t.id, { ...t, status: targetStatus, position: idx, updatedAt });
      } else if (t.position !== idx) {
        updatePos.run(idx, t.id);
        changed.set(t.id, { ...t, position: idx });
      }
    });

    const moved = this.getById(taskId)!;
    changed.set(moved.id, moved);
    return { task: moved, affectedTasks: Array.from(changed.values()) };
  }
}
