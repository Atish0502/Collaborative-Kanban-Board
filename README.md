# FlowBoard — Collaborative Kanban Board

**Live Deployment:** https://collaborative-kanban-board-pwxi.onrender.com/

## 1. Project Overview

FlowBoard is a real-time collaborative Kanban board where multiple browser sessions can view, create, edit, delete, filter, and drag tasks across four workflow columns without page refreshes. It is built to handle practical concurrency concerns: persistent task ordering, immediate optimistic UI updates with scoped rollback, and Server-Sent Events (SSE) synchronization.

## 2. Key Features

- **Four Ordered Columns**: Fixed `Backlog`, `Todo`, `In Progress`, and `Done` columns with live counts and per-column quick-add.
- **Task CRUD**: Create modal, clickable detail/edit modal (`Save Changes` / `Cancel`), and inline-confirmed deletion.
- **Drag-and-Drop (`@dnd-kit`)**: Move cards forward/backward across columns, drop into empty columns, and reorder within columns.
- **Search & Combined Filters**: Real-time client-side title search (`q`), `priority`, and `assignee` filters working independently or together, plus `Clear filters`.
- **URL State Persistence**: Filters stay synced with query parameters (`/?q=...&priority=...&assignee=...`), surviving refresh and browser Back/Forward (`popstate`).
- **Optimistic Updates & Rollback**: Immediate UI updates on all mutations with sequence-guarded rollback on failure (plus a `Simulate Failure` header toggle for testing).
- **Real-Time SSE Collaboration**: Live `task.created`, `task.updated`, and `task.deleted` sync, connection indicator, and connected client count.
- **Concurrent Editing Protection**: Isolated modal draft state, remote-change notices, and `expectedUpdatedAt` checks returning HTTP `409` with `Load Latest Task`.
- **Light / Dark Theme**: Header toggle persisted via `localStorage` and CSS custom properties.

## 3. Technology Stack

- **Frontend**: React 19, TypeScript, Vite, `@dnd-kit/core`, `@dnd-kit/sortable`, `lucide-react`, CSS
- **Backend**: Node.js, Express, TypeScript, `cors`, `dotenv`
- **Database**: SQLite (`better-sqlite3` with WAL mode and transactions)
- **Testing**: Vitest, Supertest, React Testing Library, Playwright Core (MS Edge E2E)

## 4. Architecture Overview

1. `BoardPage` loads initial tasks via `GET /api/board` and opens `EventSource` to `GET /api/events?clientId=...`.
2. Mutations update React state optimistically via `useKanbanBoard`, snapshot affected tasks in `pendingRef`, and send REST requests carrying `X-Client-Id` and `X-Mutation-Id`.
3. Express validates requests, commits atomic SQLite transactions in `TaskStore`, and broadcasts SSE events via `EventBus` only after the commit succeeds.
4. Originating tabs skip echoed events matching their `clientId`; other tabs apply updates immediately or queue them in `deferredRef` if that task has a pending local mutation.

## 5. Project Structure

```text
hoichoi/
├── client/src/
│   ├── components/   # Header, KanbanColumn, TaskCard, modals, ToastContainer
│   ├── hooks/        # useKanbanBoard.ts, useUrlFilters.ts
│   ├── pages/        # BoardPage.tsx
│   ├── services/     # api.ts
│   ├── styles/       # index.css
│   ├── types/        # kanban.ts
│   ├── utils/        # boardUtils.ts, urlState.ts
│   └── board.test.tsx
├── server/src/       # index.ts, routes.ts, db.ts, events.ts, types.ts, api.test.ts
├── scripts/          # e2e-verify.mjs, generate-pdf.mjs
├── .env.example
├── package.json
├── README.md
├── IMPLEMENTATION_REPORT.md
└── IMPLEMENTATION_REPORT.pdf
```

## 6. Installation and Setup

Requires Node.js 20+ and npm 9+.

```bash
npm install
cp .env.example .env   # optional; defaults work locally (PORT=4000, DB_PATH=./data/kanban.db)

npm run dev:server     # backend on http://localhost:4000
npm run dev:client     # frontend on http://localhost:5173 (proxies /api -> :4000)
npm run dev            # run backend and frontend together
```

## 7. API Documentation

- `GET /api/board` — Returns `{ tasks }` ordered by column rank and `position`.
- `POST /api/tasks` — Validates `title`, `priority`, `status`, string `description`/`assignee`; returns `201` with created task.
- `PATCH /api/tasks/:id` — Updates task fields and `updatedAt`; checks `expectedUpdatedAt` (returns `409` with `latestTask` on stale edit, `404` if missing).
- `DELETE /api/tasks/:id` — Deletes task, repacks column positions, returns `{ deleted: true, id }`.
- `GET /api/events` — Opens SSE stream emitting `connected`, `clients.count`, `task.created`, `task.updated`, `task.deleted`, and 25s heartbeats.
- Additional endpoints: `POST /api/tasks/reorder` (atomic cross/same-column reorder returning `{ task, affectedTasks }`) and `GET /api/health` (status + active SSE count).

## 8. Optimistic Updates and Rollback

`useKanbanBoard` assigns each mutation a `mutationId` and monotonic `seq`, saves previous affected-task snapshots in `pendingRef`, and updates React state immediately. On error, `rollbackOp` restores only tasks that neither have another pending mutation nor a higher settled sequence in `settledSeqRef`, preventing older failures from reverting newer successful edits.

## 9. Real-Time Collaboration

Each tab generates a UUID `clientId` and subscribes via native `EventSource`. Self-echoed SSE events (`evt.clientId === clientId`) are ignored. Remote events touching locked tasks wait in `deferredRef` until the local mutation settles, and remote updates apply when `incoming.updatedAt >= current.updatedAt`. On `EventSource` reconnection, `onopen` re-fetches `/api/board` while preserving still-pending local edits. Open edit modals isolate unsaved drafts from live updates and surface HTTP `409` conflicts with a `Load Latest Task` control.

## 10. Testing and Verification

| Check / Command | Result | Details |
| :--- | :--- | :--- |
| `npm run typecheck` | Passed | 0 TypeScript errors (`server` and `client`) |
| `npm run test` (`server`) | Passed | 6 passed, 0 failed (`server/src/api.test.ts`) |
| `npm run test` (`client`) | Passed | 8 passed, 0 failed (`client/src/board.test.tsx`) |
| `npm run build` | Passed | Built `server/dist/` and `client/dist/` |
| `npm run test:e2e` | Passed | 9 passed, 0 failed (`scripts/e2e-verify.mjs`, 2-browser MS Edge) |

## 11. Deployment

- **Verified Live URL**: https://collaborative-kanban-board-pwxi.onrender.com/ (`GET /api/health` returned HTTP `200`, `GET /api/board` returned `7` seeded tasks, and `GET /` served the frontend).
- **Render Setup**: Build command `npm install --include=dev && npm run build`, start command `npm run start` (`NODE_ENV=production`, `SERVE_CLIENT=true`).
- **Production Notes**: SQLite (`DB_PATH`) requires persistent local disk storage (free-tier ephemeral disks reset on sleep/redeploy and re-seed initial tasks). Reverse proxies fronting `/api/events` must disable response buffering (`proxy_buffering off;`) and keep read timeouts above 25s.

## 12. Known Limitations

- **Single-process SSE & SQLite**: `EventBus` stores SSE connections in process memory; horizontal multi-instance scaling requires Redis Pub/Sub and a shared database.
- **No Authentication**: The client counter reflects active SSE browser tabs rather than authenticated users.
- **Drag-and-Drop Concurrency**: `POST /api/tasks/reorder` supports `expectedUpdatedAt` on the backend, but `moveTask` does not send it during drag-and-drop (so concurrent drags resolve as last-write-wins).
- **Timestamp Resolution**: Remote SSE ordering compares server-generated ISO-8601 `updatedAt` strings (`bumpTimestamp` keeps them monotonic per task on a single server, though an integer revision counter would be stronger in a multi-node setup).

## 13. Coding Agents Used

- **Antigravity** — Assisted with implementation, refactoring, automated test authoring, verification, and documentation.
