# Collaborative Kanban Board — Implementation Report

**Project:** FlowBoard Collaborative Kanban Board  
**Repository:** https://github.com/Atish0502/Collaborative-Kanban-Board.git  
**Live Deployment:** https://collaborative-kanban-board-pwxi.onrender.com/  
**Date:** November 26, 2026  
**Stack:** React, TypeScript, Vite, `@dnd-kit`, Node.js, Express, SQLite (`better-sqlite3`), Server-Sent Events (SSE)

---

## Section 1 — Project Overview

FlowBoard is a multi-user Kanban board where multiple browser tabs can simultaneously view, create, edit, delete, filter, and drag tasks across four ordered columns (`Backlog`, `Todo`, `In Progress`, `Done`) while changes appear automatically in other browsers without refreshing.

The implementation focuses on keeping column positions consistent inside SQLite transactions, applying optimistic UI updates with sequence-safe rollback, protecting open edit forms against stale overwrites (HTTP `409`), persisting search/filter state in URL query parameters, and synchronizing state via Server-Sent Events.

---

## Section 2 — Technology Stack

- **React 19, TypeScript, Vite**: Strongly typed UI components, hooks, and API payloads; builds a compact production bundle (`client/dist/`).
- **@dnd-kit/core & @dnd-kit/sortable**: Pointer and keyboard drag-and-drop with a 6px pointer activation constraint so clicks open task details cleanly.
- **Node.js & Express**: REST API routing, centralized error middleware, failure-injection testing hooks, native SSE streaming (`GET /api/events`), and static frontend serving when `SERVE_CLIENT=true`.
- **SQLite (`better-sqlite3`)**: Persistent local storage with synchronous ACID transactions and WAL mode.
- **Vitest, Supertest, Testing Library, Playwright Core**: Covers SQLite persistence, API validation, UI filtering/rollback/theme toggle, and live two-browser SSE sync.

---

## Section 3 — Architecture

The project is an npm workspace monorepo (`hoichoi/`) split into `client/`, `server/`, and `scripts/`:

- **Backend (`server/src/`)**: `types.ts` defines shared task and SSE event types; `db.ts` initializes SQLite and wraps reads/writes in `TaskStore` transactions; `events.ts` (`EventBus`) manages SSE subscribers and 25s heartbeats; `routes.ts` handles validation, failure simulation, and endpoint handlers; `index.ts` exports `createApp()` and runs the HTTP server.
- **Frontend (`client/src/`)**: `services/api.ts` wraps `fetch` and parses typed `ApiError` responses; `hooks/useKanbanBoard.ts` manages board state, optimistic snapshots, rollback, and SSE reconciliation; `hooks/useUrlFilters.ts` syncs filters with browser history; `pages/BoardPage.tsx` and `components/` render the board, cards, modals, theme toggle, and toasts.

---

## Section 4 — Database

`openDatabase()` in `server/src/db.ts` enables WAL mode (`journal_mode = WAL`) on disk databases and creates `tasks` and `app_metadata`:

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

Seven sample tasks are seeded once inside a transaction if `app_metadata` lacks `seeded` and `tasks` is empty. Subsequent restarts never add duplicates, even if all tasks are deleted.

Queries in `TaskStore.getBoard()` order by column (`Backlog`, `Todo`, `In Progress`, `Done`), then `position ASC`, then `updated_at ASC`. Moves, reorders, and deletes compact positions to `0..N-1` inside a single SQLite transaction, and `bumpTimestamp()` guarantees `updatedAt` strictly advances even on sub-millisecond updates.

---

## Section 5 — API Implementation

| Endpoint | Method | Behavior | Status Codes |
| :--- | :--- | :--- | :--- |
| `/api/health` | GET | Server status, active SSE client count, failure-injection flag | `200` |
| `/api/board` | GET | Returns `{ tasks }` ordered by column and position | `200` |
| `/api/tasks` | POST | Validates fields, inserts task, emits `task.created` | `201`, `400`, `503` |
| `/api/tasks/:id` | PATCH | Partial update with `expectedUpdatedAt` check, emits `task.updated` | `200`, `400`, `404`, `409`, `503` |
| `/api/tasks/reorder` | POST | Moves task within/between columns atomically, emits `task.updated` | `200`, `400`, `404`, `409`, `503` |
| `/api/tasks/:id` | DELETE | Removes task, compacts column, emits `task.deleted` | `200`, `404`, `503` |
| `/api/events` | GET | SSE stream with `connected`, `clients.count`, `task.*`, and 25s heartbeats | `200` |

Example `409 Conflict` response when `expectedUpdatedAt` is stale:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "This task was updated by someone else while you were editing.",
    "latestTask": {
      "id": "6be77e78-df8a-40fe-917e-0749bce1a0b0",
      "title": "Winner From A",
      "status": "Todo",
      "position": 0,
      "updatedAt": "2026-11-25T15:10:12.004Z"
    }
  }
}
```

---

## Section 6 — Frontend Implementation

- **Header (`Header.tsx`)**: Brand logo, board title, SSE status pill (`Live` / `Connecting` / `Reconnecting`), connected client count (explicitly labeled as browser connections), light/dark theme toggle, QA `Simulate Failure` toggle, title search input, Priority and Assignee dropdowns, `Clear filters` button, and `Add Task`.
- **Columns & Cards (`KanbanColumn.tsx`, `TaskCard.tsx`)**: Four ordered columns with task counts, quick-add buttons, empty states, priority badges, priority left border accents, description previews, and assignee avatars.
- **Modals & Toasts (`CreateTaskModal.tsx`, `TaskDetailModal.tsx`, `ToastContainer.tsx`)**: Required-title validation, isolated edit drafts, remote-change notices, HTTP `409` recovery (`Load Latest Task`), inline delete confirmation, and non-blocking toast notifications with retry on initial load failure.
- **Theme Support (`BoardPage.tsx`, `index.css`)**: CSS variable overrides under `[data-theme='dark']` persisted in `localStorage`.

---

## Section 7 — Drag-and-Drop

`BoardPage.tsx` uses `DndContext` with `PointerSensor` (`distance: 6`) and `KeyboardSensor`. `detectTarget()` checks `pointerWithin` first (preferring individual task cards over the parent column box) and falls back to `rectIntersection` and `closestCorners` so empty columns accept drops reliably.

`calculateReorderPlan()` computes target indices against the full `tasks` list (preserving hidden tasks when filters are active), applies the optimistic layout immediately, and posts `{ taskId, targetStatus, targetPosition }` to `POST /api/tasks/reorder`.

---

## Section 8 — Search, Filters, and URL State

`filterTasks()` filters client-side by title substring (`q`), `priority`, and `assignee` simultaneously without mutating SQLite. `useUrlFilters()` reads `window.location.search` on mount, ignores invalid `priority` values, updates the URL with `pushState` (or `replaceState` within 600ms while typing so browser history stays clean), and listens to `popstate` for Back/Forward navigation.

---

## Section 9 — Optimistic Updates

1. Before sending a mutation, `startOp()` assigns a `mutationId` and monotonic sequence (`seq`) and snapshots only the affected task IDs into `pendingRef`.
2. React state updates immediately so cards appear, update, move, or disappear without waiting for the network.
3. On HTTP `2xx`, the pending entry is deleted, `settledSeqRef` records `op.seq`, and canonical server data replaces temporary placeholders (`temp-*` IDs).
4. On any error, `rollbackOp()` restores snapshotted tasks only if no newer pending operation touches them (`!isLocked(taskId)`) and `(settledSeqRef.get(taskId) ?? 0) <= op.seq`. This prevents a delayed older failure from overwriting newer successful edits. Deferred SSE events are drained immediately afterward.

---

## Section 10 — Real-Time Collaboration & Timestamp Assessment

- **SSE (`EventBus`)**: Sends `text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`, `retry: 2000`, and `:heartbeat` comments every 25s; cleans up closed sockets on `req.on('close')`.
- **Self-Echo Suppression & Locking**: Each tab generates a UUID `clientId` and skips events matching its own `clientId`. Remote events touching any task in `pendingRef` wait in `deferredRef` until the local mutation settles.
- **Modal Concurrency**: `TaskDetailModal` captures `baseUpdatedAt` when opened and keeps edits in local `draft` state. Remote updates warn the user without overwriting unsaved text, and saving sends `expectedUpdatedAt` to trigger HTTP `409` on stale edits.
- **Reconnection**: When `EventSource` reconnects after dropping, `onopen` re-fetches `/api/board` (`loadBoard(true)`) while preserving still-pending local mutations.
- **Timestamp Resolution Assessment**: Remote updates compare `incoming.updatedAt >= current.updatedAt`. Because `bumpTimestamp()` generates strictly increasing ISO-8601 timestamps on a single Node server and sibling position shifts during `moveInTx` retain equal `updatedAt` values (handled by `>=`), this works reliably on a single server instance. However, an integer monotonic `version` column would be safer if the backend were ever scaled across multiple nodes with independent clocks. Also note that `moveTask` does not pass `expectedUpdatedAt` to `POST /api/tasks/reorder`, so concurrent drag-and-drop moves use last-write-wins.

---

## Section 11 — Testing & Deployment Verification

All checks below were executed cleanly with zero skipped tests:

| Verification Check | Result | Scope & Counts |
| :--- | :--- | :--- |
| `npm run typecheck` | Passed | 0 TypeScript errors across `server` and `client` |
| `npm --workspace=server run test` | Passed (6/6) | Seed-once, CRUD/validation/404, HTTP `409`, atomic reorder, live SSE, `503` failure injection |
| `npm --workspace=client run test` | Passed (8/8) | URL query parsing/sync, combined filters, theme toggle, `popstate`, reorder math, rollback, `409` modal, SSE sync |
| `npm run build` | Passed | Compiled `server/dist/` and `client/dist/` |
| `npm run test:e2e` | Passed (9/9) | Dual-browser MS Edge Playwright suite (live SSE create/edit/delete, `409` conflict, drag-and-drop, URL refresh, rollback, offline reconnect) |
| Live Render probe (`https://collaborative-kanban-board-pwxi.onrender.com/`) | Verified | `GET /api/health` (`200`), `GET /api/board` (`200`, 7 tasks), `GET /` (`200`, FlowBoard client) |

---

## Section 12 — Running the Application

```bash
npm install
npm run dev
```

Production single-server mode:

```bash
npm run build
# PowerShell:
$env:SERVE_CLIENT="true"; $env:NODE_ENV="production"; npm run start
```

---

## Section 13 — Limitations and Future Improvements

- **Single-process SSE & SQLite**: `EventBus` keeps connections in process memory; multi-instance scaling would require Redis Pub/Sub and migrating SQLite to PostgreSQL.
- **Free-tier Ephemeral Disk**: On free Render tiers without a persistent disk, SQLite resets when the container sleeps or redeploys and re-seeds the 7 initial tasks.
- **Drag-and-Drop Concurrency**: `moveTask` omits `expectedUpdatedAt`, unlike `TaskDetailModal` saves.
- **Authentication**: No user login or RBAC; the client counter shows active browser SSE connections.

---

## Section 14 — Final Completion Checklist

- [x] React + TypeScript frontend implemented
- [x] Node.js + Express backend implemented
- [x] SQLite (`better-sqlite3`) persistence
- [x] Four columns in fixed order (`Backlog`, `Todo`, `In Progress`, `Done`)
- [x] Board fetched from API & CRUD modals implemented
- [x] Drag between columns and reorder within columns (`@dnd-kit`)
- [x] Atomic position persistence
- [x] Title search, priority filter, assignee filter, combined filtering
- [x] URL query persistence and Back/Forward support
- [x] Optimistic updates and scoped rollback
- [x] SSE live sync and reconnect reconciliation
- [x] Concurrent update protection (`409 Conflict` in edit modal)
- [x] Light/dark theme toggle
- [x] `README.md` and `.env.example`
- [x] Unit, API, build, and 2-browser E2E tests verified
- [x] Live Render deployment verified (`https://collaborative-kanban-board-pwxi.onrender.com/`)
- [x] `IMPLEMENTATION_REPORT.md` and `IMPLEMENTATION_REPORT.pdf`
