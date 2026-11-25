# Collaborative Kanban Board — Implementation Report

**Project:** FlowBoard Collaborative Kanban Board  
**Date:** November 25, 2026  
**Stack:** React, TypeScript, Vite, `@dnd-kit`, Node.js, Express, SQLite (`better-sqlite3`), Server-Sent Events (SSE)

---

## Section 1 — Project Overview

This project is a multi-user Kanban board where people can view, create, edit, delete, filter, and drag tasks across four columns (`Backlog`, `Todo`, `In Progress`, `Done`) while updates appear automatically in other open browsers without refreshing.

The main technical work went into keeping task positions consistent in SQLite, applying optimistic updates in React without losing track of concurrent edits, rolling back failed requests safely, and syncing state across tabs over Server-Sent Events.

---

## Section 2 — Technology Stack

- **React 19, TypeScript, Vite**: Keeps UI components and API payloads strongly typed while building a small client bundle (`client/dist`).
- **@dnd-kit/core & @dnd-kit/sortable**: Handles pointer and keyboard drag-and-drop cleanly, including a 6px drag activation distance so normal clicks open task details without triggering a drag.
- **Node.js & Express**: Serves the REST endpoints, streams SSE responses on `GET /api/events`, and serves the built frontend when `SERVE_CLIENT=true`.
- **SQLite (`better-sqlite3`)**: Stores tasks on disk with synchronous ACID transactions and WAL mode, avoiding extra database setup.
- **Vitest, Supertest, Testing Library, Playwright Core**: Covers backend routes, SQLite ordering, UI filtering/rollback, and live two-browser SSE sync.

---

## Section 3 — Architecture

The codebase is split into two npm workspaces (`server` and `client`) plus helper scripts in `scripts/`:

- **Backend (`server/src/`)**: `types.ts` defines shared models and SSE payloads, `db.ts` initializes SQLite and wraps all reads/writes in `TaskStore` transactions, `events.ts` manages SSE subscribers and heartbeats (`EventBus`), `routes.ts` handles validation, failure injection, and API endpoints, and `index.ts` wires up Express (`createApp`).
- **Frontend (`client/src/`)**: `services/api.ts` wraps `fetch` and parses typed HTTP errors, `hooks/useKanbanBoard.ts` holds board state, optimistic snapshots, and SSE handling, `hooks/useUrlFilters.ts` syncs query params with browser history, and `components/` renders the board, cards, modals, and toasts.

---

## Section 4 — Database

`openDatabase()` in `server/src/db.ts` creates `tasks` and `app_metadata` on startup:

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
```

Seven sample tasks are seeded once inside a transaction if `app_metadata` does not yet contain `seeded` and `tasks` is empty. Subsequent restarts never add duplicates, even if all tasks are deleted.

Task queries always order by column (`Backlog`, `Todo`, `In Progress`, `Done`), then `position ASC`, then `updated_at ASC`. Moves, reorders, and deletes compact positions to `0..N-1` inside a single SQLite transaction, and `bumpTimestamp()` guarantees `updatedAt` moves forward even on sub-millisecond updates.

---

## Section 5 — API Implementation

| Endpoint | Method | Behavior | Status Codes |
| :--- | :--- | :--- | :--- |
| `/api/health` | GET | Server status, active SSE client count, failure flag | `200` |
| `/api/board` | GET | Returns `{ tasks }` ordered by column and position | `200` |
| `/api/tasks` | POST | Validates fields, inserts task, emits `task.created` | `201`, `400`, `503` |
| `/api/tasks/:id` | PATCH | Partial update with `expectedUpdatedAt` check, emits `task.updated` | `200`, `400`, `404`, `409`, `503` |
| `/api/tasks/reorder` | POST | Moves task within/between columns atomically, emits `task.updated` | `200`, `400`, `404`, `409`, `503` |
| `/api/tasks/:id` | DELETE | Removes task, compacts column, emits `task.deleted` | `200`, `404`, `503` |
| `/api/events` | GET | SSE stream with 25s heartbeats and disconnect cleanup | `200` |

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

- **Header (`Header.tsx`)**: Displays app logo, board name, SSE status pill (`Live` / `Connecting` / `Reconnecting`), connected client count (explicitly labeled as active browser connections), QA `Simulate Failure` toggle, title search bar, Priority and Assignee dropdowns, `Clear filters` button, and `Add Task`.
- **Columns & Cards (`KanbanColumn.tsx`, `TaskCard.tsx`)**: Renders the four columns in order with task counts, quick-add buttons, empty states, priority badges, subtle left priority borders, description previews, and assignee avatars.
- **Modals & Toasts (`CreateTaskModal.tsx`, `TaskDetailModal.tsx`, `ToastContainer.tsx`)**: Validates required titles, keeps edit drafts isolated from live board updates, confirms deletes inline, and displays success/error/warning notifications with retry actions when initial loading fails.

---

## Section 7 — Drag-and-Drop

`BoardPage.tsx` uses `DndContext` with `PointerSensor` (`distance: 6`) and `KeyboardSensor`. `detectTarget()` checks `pointerWithin` first—preferring task cards over the parent column box when hovering a card—and falls back to `rectIntersection` and `closestCorners` so empty columns also accept drops reliably.

`calculateReorderPlan()` computes target indices against the full `tasks` list (preserving hidden items when filters are active), applies the optimistic layout right away, and posts `{ taskId, targetStatus, targetPosition }` to `/api/tasks/reorder`.

---

## Section 8 — Search, Filters, and URL State

`filterTasks()` filters client-side by title substring (`q`), `priority`, and `assignee` at the same time without touching SQLite. `useUrlFilters()` reads `window.location.search` on load, ignores invalid priority values, updates the URL with `pushState` (or `replaceState` for quick consecutive typing so browser history stays tidy), and listens to `popstate` for Back/Forward navigation.

---

## Section 9 — Optimistic Updates

1. Before calling the API, `startOp()` assigns a `mutationId` and sequence number (`seq`) and snapshots only the tasks touched by that operation into `pendingRef`.
2. React state updates right away so cards appear, change, move, or disappear immediately.
3. On HTTP `2xx`, the pending entry is cleared, `settledSeqRef` records `op.seq`, and canonical server data replaces temporary placeholders.
4. On any error, `rollbackOp()` restores the snapshotted tasks only if no newer pending operation touches them and `settledSeqRef` has not moved past `op.seq`. That prevents an older failed request from overwriting newer work. Any queued remote SSE events are drained immediately afterward.

---

## Section 10 — Real-Time Collaboration

- **SSE (`EventBus`)**: Sets `text/event-stream`, `no-cache, no-transform`, `X-Accel-Buffering: no`, `retry: 2000`, and sends `:heartbeat` comments every 25 seconds. Disconnected sockets are removed on `req.on('close')`.
- **Client & Mutation IDs**: Each tab generates a `clientId` and ignores SSE events echoing its own `clientId`.
- **Deferred Remote Events**: If an incoming SSE event touches a task currently locked in `pendingRef`, it waits in `deferredRef` until the local mutation settles.
- **Timestamp Guard**: Remote updates only apply when `incoming.updatedAt >= current.updatedAt`.
- **Modal Concurrency**: `TaskDetailModal` captures `baseUpdatedAt` when opened and keeps form edits in local `draft` state. If a remote edit arrives while the modal is open, a banner warns the user without overwriting their typing. Saving sends `expectedUpdatedAt`; HTTP `409` displays the latest server version with a `Load Latest Task` button.
- **Reconnection**: When `EventSource` reconnects after dropping, `onopen` fetches `/api/board` once to pull any missed updates while keeping pending local edits intact.

---

## Section 11 — Testing

All suites ran against the simplified codebase with zero skipped tests:

- **`npm run typecheck`**: Passed (0 errors in `server` and `client`).
- **`npm --workspace=server run test`** (`server/src/api.test.ts`): **6/6 passed** — first-boot seeding without restart duplicates, CRUD + validation + 404, HTTP `409` conflict check, atomic same/cross-column reorder, live SSE broadcast (`task.created`, `task.updated`, `task.deleted`), and `503` failure injection.
- **`npm --workspace=client run test`** (`client/src/board.test.tsx`): **8/8 passed** — URL query parsing/building, combined filtering, reorder math, 4-column rendering + live filter + URL sync, URL restore + `popstate`, optimistic create rollback on `503`, modal draft preservation + `409` recovery, and remote SSE sync.
- **`npm run build`**: Passed (`server/dist/` and `client/dist/`).
- **`npm run test:e2e`** (`scripts/e2e-verify.mjs`): **9/9 passed** using two separate Microsoft Edge browser contexts against the compiled server: dual-client SSE load, create/edit/delete sync, HTTP `409` conflict flow, cross-column drag-and-drop persistence, filter URL persistence across refresh, failure-toggle rollback, and offline reconnect sync.

---

## Section 12 — Running the Application

```bash
npm install
npm run dev
```

For a single-server production run:

```bash
npm run build
# PowerShell:
$env:SERVE_CLIENT="true"; $env:NODE_ENV="production"; npm run start
```

---

## Section 13 — Limitations and Future Improvements

- **Deployment status**: Prepared for production serving (`SERVE_CLIENT=true`, configurable `DB_PATH`), currently tested locally and undeployed. Reverse proxies fronting `/api/events` must disable response buffering (`proxy_buffering off`) and use read timeouts longer than 25s.
- **Single-process SSE**: `EventBus` keeps connections in memory; multi-instance scaling would need Redis Pub/Sub and a shared database instead of SQLite.
- **Auth**: No login/user accounts; client count reflects open browser SSE tabs.

---

## Section 14 — Final Completion Checklist

- [x] React + TypeScript frontend
- [x] Node.js + Express backend
- [x] SQLite (`better-sqlite3`) persistence
- [x] Four columns in fixed order
- [x] Board fetched from API
- [x] Create, edit, delete, and task detail modal
- [x] Drag between columns and reorder within columns
- [x] Atomic position persistence
- [x] Title search, priority filter, assignee filter, combined filtering
- [x] URL query persistence and Back/Forward support
- [x] Optimistic updates and scoped rollback
- [x] SSE real-time sync and reconnect reconciliation
- [x] Concurrent update protection (`409 Conflict`)
- [x] `README.md` and `.env.example`
- [x] Unit, integration, and 2-browser E2E tests passing
- [x] Production build verified
- [x] `IMPLEMENTATION_REPORT.md` and `IMPLEMENTATION_REPORT.pdf`
