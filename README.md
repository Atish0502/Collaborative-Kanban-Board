# FlowBoard — Collaborative Kanban Board

FlowBoard is a multi-user Kanban board built with React, TypeScript, `@dnd-kit`, Express, SQLite (`better-sqlite3`), and Server-Sent Events (SSE). People can open the board in multiple browser tabs, add or edit tasks, drag cards between columns, and see changes show up in other tabs without reloading the page.

## 1. Project Overview

The goal of this project is to handle the practical parts of a shared task board: keeping column order consistent in SQLite, updating the UI right away without waiting on the network, rolling back only what failed if a request errors out, and syncing changes across open tabs over SSE.

## 2. Features Implemented

- Four columns in fixed order: `Backlog`, `Todo`, `In Progress`, `Done`, with live task counts and quick-add buttons.
- Create, view/edit, and delete tasks via modals, including inline delete confirmation.
- Drag and drop via `@dnd-kit` across columns, into empty columns, and within the same column.
- Client-side search by task title paired with independent Priority and Assignee dropdown filters plus a Clear filters button.
- URL query parameter sync (`/?q=...&priority=...&assignee=...`) that survives page refreshes and works with browser Back/Forward navigation.
- Optimistic updates on create, edit, delete, and drag-and-drop with scoped rollback when the server returns an error.
- Live SSE sync (`task.created`, `task.updated`, `task.deleted`), connection status pill (`Live`, `Connecting`, `Reconnecting`), connected client count, and automatic board refresh on reconnect.
- Concurrent edit protection: open edit forms keep their own draft state, warn if someone else edits the task, and check `expectedUpdatedAt` on save so stale edits return HTTP `409` with a `Load Latest Task` option.
- Failure simulation toggle (`Simulate Failure` button in the header, plus `FAILURE_INJECTION_ENABLED` and `X-Simulate-Failure` support, disabled by default).

## 3. Technologies Used

- **Frontend**: React 19, TypeScript, Vite, `@dnd-kit/core`, `@dnd-kit/sortable`, `lucide-react`, plain CSS.
- **Backend**: Node.js, Express, TypeScript, `cors`, `dotenv`.
- **Database**: SQLite via `better-sqlite3`.
- **Testing**: Vitest, Supertest, React Testing Library, Playwright Core (with Microsoft Edge for E2E checks and PDF output).

## 4. Architecture Overview

The app uses a straightforward client-server flow:

1. On startup, the React client fetches the full ordered board from `GET /api/board` and opens a `GET /api/events?clientId=<uuid>` SSE stream.
2. When a user creates, updates, deletes, or drags a card, the UI updates immediately, stores a snapshot of the affected tasks in `pendingRef`, and sends the REST request with `X-Client-Id` and `X-Mutation-Id` headers.
3. Express validates the payload, runs the SQLite change inside a transaction, and broadcasts the event via `EventBus` only after the transaction commits.
4. The originating tab ignores its own echoed SSE event (by checking `clientId`). Other tabs apply the event immediately unless they currently have a pending edit on that same task, in which case the event is queued until the local request finishes.

## 5. Project Directory Structure

```text
hoichoi/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CreateTaskModal.tsx
│   │   │   ├── Header.tsx
│   │   │   ├── KanbanColumn.tsx
│   │   │   ├── TaskCard.tsx
│   │   │   ├── TaskDetailModal.tsx
│   │   │   └── ToastContainer.tsx
│   │   ├── hooks/
│   │   │   ├── useKanbanBoard.ts
│   │   │   └── useUrlFilters.ts
│   │   ├── pages/
│   │   │   └── BoardPage.tsx
│   │   ├── services/
│   │   │   └── api.ts
│   │   ├── styles/
│   │   │   └── index.css
│   │   ├── types/
│   │   │   └── kanban.ts
│   │   ├── utils/
│   │   │   ├── boardUtils.ts
│   │   │   └── urlState.ts
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── board.test.tsx
│   │   ├── testSetup.ts
│   │   └── vite-env.d.ts
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── server/
│   ├── src/
│   │   ├── db.ts
│   │   ├── events.ts
│   │   ├── index.ts
│   │   ├── routes.ts
│   │   ├── types.ts
│   │   └── api.test.ts
│   ├── package.json
│   └── tsconfig.json
├── scripts/
│   ├── e2e-verify.mjs
│   └── generate-pdf.mjs
├── .env.example
├── .gitignore
├── package.json
├── README.md
├── IMPLEMENTATION_REPORT.md
└── IMPLEMENTATION_REPORT.pdf
```

## 6. Database Design

`openDatabase()` in `server/src/db.ts` creates the SQLite database file if it does not exist, turns on WAL mode (`journal_mode = WAL`), and creates two tables:

```sql
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
```

On the very first boot, 7 sample tasks are inserted inside a transaction and `app_metadata` records a `seeded` key. If you delete all tasks later and restart the server, the sample tasks are not re-inserted. Positions inside each column are kept contiguous (`0..N-1`) inside SQLite transactions whenever tasks are inserted, reordered, moved, or deleted.

## 7. API Documentation

Base prefix: `/api`

- `GET /api/health` — Returns `{ status, timestamp, connectedClients, failureInjectionEnabled }`.
- `GET /api/board` — Returns `{ tasks: Task[] }` sorted by column order (`Backlog`, `Todo`, `In Progress`, `Done`) and `position`.
- `POST /api/tasks` — Creates a task. Requires non-empty `title`, valid `priority` (`low`, `medium`, `high`), valid `status`, and string `description`/`assignee`. Returns `201` with the created task.
- `PATCH /api/tasks/:id` — Updates any subset of `title`, `description`, `priority`, `assignee`, `status`, `position`. Checks `expectedUpdatedAt` if passed and returns `409` with `latestTask` on mismatch, or `404` if missing.
- `POST /api/tasks/reorder` — Moves `{ taskId, targetStatus, targetPosition }` in a single SQLite transaction and returns `{ task, affectedTasks }`.
- `DELETE /api/tasks/:id` — Deletes the task, compacts positions in its column, and returns `{ deleted: true, id }`.
- `GET /api/events?clientId=<uuid>` — Opens the SSE stream. Sends `connected`, `clients.count`, `task.created`, `task.updated`, and `task.deleted` events plus `:heartbeat` comments every 25s.

## 8. Installation Instructions

Requires Node.js 20+ and npm 9+.

```bash
npm install
```

## 9. Environment Configuration

Copy `.env.example` to `.env` if you want to override defaults:

```bash
cp .env.example .env
```

Available variables:
- `PORT`: Backend port (default `4000`).
- `DB_PATH`: Path to the SQLite file (default `./data/kanban.db`).
- `CORS_ORIGIN`: Allowed origin for the Vite dev server (default `http://localhost:5173`).
- `SERVE_CLIENT`: Set to `true` in production to serve `client/dist` from Express.
- `FAILURE_INJECTION_ENABLED`: `false` by default. Set to `true` to simulate server errors on mutations.
- `FAILURE_INJECTION_RATE`: Value between `0` and `1` controlling failure probability when enabled.
- `ALLOW_FAILURE_INJECTION_HEADER`: Allows `X-Simulate-Failure: true` header for testing (`true` by default).
- `SSE_HEARTBEAT_MS`: Heartbeat interval in milliseconds (default `25000`).

## 10. How to Start the Backend

```bash
npm run dev:server
```

## 11. How to Start the Frontend

```bash
npm run dev:client
```

Vite runs at `http://localhost:5173` and proxies `/api` requests to `http://localhost:4000`.

## 12. How to Run Both Together

```bash
npm run dev
```

Or run the compiled production server serving the built frontend:

```bash
npm run build
# PowerShell:
$env:SERVE_CLIENT="true"; $env:NODE_ENV="production"; npm run start
```

## 13. How to Run Tests

```bash
# TypeScript checks
npm run typecheck

# Server + client unit and integration tests
npm run test

# Production build + two-browser E2E test suite (uses local MS Edge)
npm run build
npm run test:e2e
```

## 14. How to Build for Production

```bash
npm run build
```

This outputs `server/dist/` and `client/dist/`.

### Production & Proxy Notes
- Reverse proxies (Nginx, Caddy, cloud load balancers) sitting in front of `/api/events` need response buffering turned off (`proxy_buffering off;` in Nginx; the server also sets `X-Accel-Buffering: no`) and read timeouts set higher than the 25-second SSE heartbeat interval.
- SQLite (`DB_PATH`) needs a persistent local disk volume, not ephemeral container storage or a network mount.
- The app is configured for production builds and static serving (`SERVE_CLIENT=true`) and is currently undeployed outside `localhost`.

## 15. How Optimistic Updates Work

Each mutation in `client/src/hooks/useKanbanBoard.ts` (`createTask`, `updateTask`, `deleteTask`, `moveTask`) assigns a `mutationId` and sequence number, saves a snapshot of the affected tasks in `pendingRef`, updates React state immediately, and then fires the API call with `X-Client-Id` and `X-Mutation-Id`. When the request succeeds, the UI replaces temporary IDs or optimistic values with the canonical task returned by the server.

## 16. How Rollback Works

If a mutation fails, `rollbackOp()` removes the entry from `pendingRef` and restores the snapshotted tasks only if no newer pending operation touches them and no newer committed sequence (`settledSeqRef`) has already updated that task. That way, a slow failing request cannot undo a newer successful edit. Any deferred SSE events are drained right after rollback, and a toast notifies the user.

## 17. How Real-Time Events Work

Each browser tab generates a `clientId` on load and opens an `EventSource` to `/api/events?clientId=...`. When any request mutates the database, `EventBus.emit()` broadcasts `task.created`, `task.updated`, or `task.deleted` to all connected clients. Tabs ignore events whose `clientId` matches their own tab ID. If the connection drops and comes back, `onopen` fetches `/api/board` once to catch up on missed changes while keeping any still-pending local edits intact.

## 18. How Concurrent Updates Are Handled

- Incoming SSE events for a task that currently has an in-flight local mutation are pushed onto `deferredRef` and replayed once the local request settles.
- Remote updates check `incoming.updatedAt >= current.updatedAt` before modifying state.
- `TaskDetailModal` keeps form edits in an isolated `draft` object and captures `baseUpdatedAt` when opened. Remote changes show a notice in the modal without overwriting unsaved text. Saving passes `expectedUpdatedAt`; if someone else saved first, the server returns HTTP `409` with `latestTask`, and the modal offers a `Load Latest Task` button.

## 19. Known Limitations

- There is no user login system; the client counter reflects open SSE browser tabs rather than authenticated accounts.
- `EventBus` keeps SSE streams in memory on a single Node process. Scaling across multiple backend instances would require Redis Pub/Sub and a shared database instead of SQLite.
- There is no manual Undo (`Ctrl+Z`) history stack beyond automatic error rollback.

## 20. Coding Agents Used

- Antigravity was used to assist with scaffolding, refactoring, writing automated tests, and generating the PDF report.
