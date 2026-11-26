import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_PDF = path.resolve(process.cwd(), 'IMPLEMENTATION_REPORT.pdf');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>FlowBoard — Implementation Report</title>
<style>
  @page {
    size: A4;
    margin: 20mm 16mm 20mm 16mm;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
    font-size: 9.8pt;
    line-height: 1.52;
    color: #0f172a;
    background: #ffffff;
  }
  .cover-page {
    min-height: 245mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    page-break-after: always;
    padding: 10mm 4mm 6mm;
  }
  .cover-badge {
    display: inline-block;
    padding: 5px 12px;
    border-radius: 999px;
    background: #eef2ff;
    color: #4338ca;
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .cover-title {
    margin: 18px 0 10px;
    font-size: 27pt;
    line-height: 1.15;
    font-weight: 800;
    color: #0f172a;
  }
  .cover-subtitle {
    margin: 0 0 22px;
    font-size: 11.8pt;
    line-height: 1.5;
    color: #475569;
    max-width: 92%;
  }
  .cover-bar {
    width: 68px;
    height: 4px;
    border-radius: 2px;
    background: #4f46e5;
    margin-bottom: 22px;
  }
  .cover-metrics {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin: 16px 0 24px;
  }
  .metric-box {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 14px;
    background: #f8fafc;
  }
  .metric-val { font-size: 13.5pt; font-weight: 800; color: #4f46e5; }
  .metric-label { margin-top: 2px; font-size: 8.4pt; color: #475569; font-weight: 600; }
  .cover-meta {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 14px 16px;
    background: #f8fafc;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 20px;
    font-size: 9pt;
  }
  .meta-key { font-size: 7.8pt; text-transform: uppercase; color: #64748b; font-weight: 700; }
  .meta-val { color: #0f172a; font-weight: 600; word-break: break-word; }
  h2 {
    margin: 18px 0 8px;
    padding-bottom: 5px;
    border-bottom: 2px solid #e2e8f0;
    font-size: 13pt;
    font-weight: 800;
    break-after: avoid;
    page-break-after: avoid;
  }
  .sec-num {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 5px;
    background: #eef2ff;
    color: #4338ca;
    font-size: 8.8pt;
    margin-right: 6px;
  }
  p { margin: 0 0 8px; color: #334155; }
  ul, ol { margin: 4px 0 10px; padding-left: 20px; color: #334155; }
  li { margin-bottom: 4px; }
  code {
    font-family: Consolas, 'Courier New', monospace;
    font-size: 8.4pt;
    background: #f1f5f9;
    color: #0f172a;
    padding: 1px 4px;
    border-radius: 4px;
    word-break: break-word;
  }
  pre {
    margin: 8px 0 12px;
    padding: 10px 12px;
    border-radius: 7px;
    background: #0f172a;
    color: #e2e8f0;
    font-family: Consolas, 'Courier New', monospace;
    font-size: 8pt;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
    break-inside: avoid;
  }
  pre code { background: transparent; color: inherit; padding: 0; }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0 14px;
    font-size: 8.7pt;
    break-inside: avoid;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
    word-break: break-word;
  }
  th { background: #f1f5f9; font-weight: 700; }
  .diagram-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px;
    background: #fafcff;
    margin: 10px 0 14px;
    break-inside: avoid;
  }
  .diagram-caption {
    margin-top: 5px;
    font-size: 8.4pt;
    color: #64748b;
    text-align: center;
    font-weight: 600;
  }
  .badge-pass {
    display: inline-block;
    padding: 1px 7px;
    border-radius: 999px;
    background: #dcfce7;
    color: #166534;
    font-weight: 700;
    font-size: 7.8pt;
  }
  .checklist { list-style: none; padding-left: 0; columns: 2; column-gap: 16px; }
  .checklist li { break-inside: avoid; margin-bottom: 5px; font-size: 8.8pt; }
  .chk {
    display: inline-block;
    width: 13px;
    height: 13px;
    line-height: 12px;
    text-align: center;
    border-radius: 3px;
    background: #059669;
    color: #fff;
    font-size: 8pt;
    font-weight: 700;
    margin-right: 6px;
  }
</style>
</head>
<body>

  <section class="cover-page">
    <div>
      <span class="cover-badge">Implementation Report</span>
      <h1 class="cover-title">FlowBoard:<br/>Collaborative Kanban Board</h1>
      <div class="cover-bar"></div>
      <p class="cover-subtitle">
        Multi-user Kanban board built with React, TypeScript, @dnd-kit, Express, SQLite (better-sqlite3), and Server-Sent Events (SSE).
      </p>

      <div class="cover-metrics">
        <div class="metric-box">
          <div class="metric-val">4 Columns</div>
          <div class="metric-label">Backlog, Todo, In Progress, Done</div>
        </div>
        <div class="metric-box">
          <div class="metric-val">23 / 23</div>
          <div class="metric-label">Server, Client &amp; E2E Tests Passing</div>
        </div>
        <div class="metric-box">
          <div class="metric-val">Live on Render</div>
          <div class="metric-label">Verified HTTP 200 API &amp; Client</div>
        </div>
      </div>

      <div class="diagram-card">
        <svg viewBox="0 0 720 175" width="100%" xmlns="http://www.w3.org/2000/svg">
          <rect x="14" y="20" width="182" height="58" rx="8" fill="#eef2ff" stroke="#6366f1" stroke-width="1.5"/>
          <text x="105" y="45" text-anchor="middle" font-size="11.5" font-weight="700" fill="#1e1b4b">Browser Tab A</text>
          <text x="105" y="62" text-anchor="middle" font-size="9.5" fill="#4338ca">React + @dnd-kit + Optimistic UI</text>

          <rect x="14" y="98" width="182" height="58" rx="8" fill="#eef2ff" stroke="#6366f1" stroke-width="1.5"/>
          <text x="105" y="123" text-anchor="middle" font-size="11.5" font-weight="700" fill="#1e1b4b">Browser Tab B</text>
          <text x="105" y="140" text-anchor="middle" font-size="9.5" fill="#4338ca">EventSource + Conflict Modal</text>

          <rect x="274" y="38" width="202" height="100" rx="8" fill="#ecfeff" stroke="#0891b2" stroke-width="1.5"/>
          <text x="375" y="65" text-anchor="middle" font-size="12" font-weight="700" fill="#164e63">Express Server</text>
          <text x="375" y="85" text-anchor="middle" font-size="9.5" fill="#0e7490">routes.ts • TaskStore • EventBus</text>
          <text x="375" y="103" text-anchor="middle" font-size="9.5" fill="#0e7490">Validation &amp; Failure Simulation</text>
          <text x="375" y="121" text-anchor="middle" font-size="9" fill="#155e75">GET / POST / PATCH / DELETE / SSE</text>

          <rect x="546" y="52" width="158" height="72" rx="8" fill="#f0fdf4" stroke="#16a34a" stroke-width="1.5"/>
          <text x="625" y="80" text-anchor="middle" font-size="11.5" font-weight="700" fill="#14532d">SQLite (WAL)</text>
          <text x="625" y="98" text-anchor="middle" font-size="9.5" fill="#15803d">better-sqlite3</text>
          <text x="625" y="113" text-anchor="middle" font-size="9" fill="#166534">Transactions &amp; Ordering</text>

          <line x1="196" y1="44" x2="272" y2="72" stroke="#4f46e5" stroke-width="1.5"/>
          <polygon points="272,72 263,68 266,76" fill="#4f46e5"/>
          <text x="234" y="50" text-anchor="middle" font-size="8.5" fill="#4f46e5">REST</text>

          <line x1="272" y1="108" x2="196" y2="132" stroke="#0891b2" stroke-width="1.5" stroke-dasharray="4 3"/>
          <polygon points="196,132 205,134 202,126" fill="#0891b2"/>
          <text x="234" y="136" text-anchor="middle" font-size="8.5" fill="#0891b2">SSE</text>

          <line x1="476" y1="88" x2="544" y2="88" stroke="#16a34a" stroke-width="1.5"/>
          <polygon points="544,88 536,84 536,92" fill="#16a34a"/>
        </svg>
        <div class="diagram-caption">Figure 1: Client, Express API, SSE EventBus, and SQLite layout</div>
      </div>
    </div>

    <div class="cover-meta">
      <div>
        <div class="meta-key">Application</div>
        <div class="meta-val">FlowBoard Collaborative Kanban (hoichoi/)</div>
      </div>
      <div>
        <div class="meta-key">Report Date</div>
        <div class="meta-val">November 26, 2026</div>
      </div>
      <div>
        <div class="meta-key">GitHub Repository</div>
        <div class="meta-val">github.com/Atish0502/Collaborative-Kanban-Board</div>
      </div>
      <div>
        <div class="meta-key">Live Deployment</div>
        <div class="meta-val">collaborative-kanban-board-pwxi.onrender.com</div>
      </div>
      <div>
        <div class="meta-key">Frontend Stack</div>
        <div class="meta-val">React 19, TypeScript, Vite, @dnd-kit</div>
      </div>
      <div>
        <div class="meta-key">Backend &amp; DB</div>
        <div class="meta-val">Node.js, Express, better-sqlite3, SSE</div>
      </div>
    </div>
  </section>

  <h2><span class="sec-num">01</span> Project Overview</h2>
  <p>
    FlowBoard is a collaborative Kanban board where multiple browser sessions can view, create, edit, delete, filter,
    and drag tasks across four ordered columns (<code>Backlog</code>, <code>Todo</code>, <code>In Progress</code>,
    <code>Done</code>) with live Server-Sent Events (SSE) synchronization.
  </p>
  <p>
    The design emphasizes consistent transactional ordering in SQLite, immediate optimistic updates with sequence-safe
    rollback, stale-edit conflict protection (HTTP <code>409</code>), URL-persisted filtering, and light/dark theming.
  </p>

  <h2><span class="sec-num">02</span> Technology Stack</h2>
  <table>
    <thead><tr><th>Layer</th><th>Stack</th><th>Why Chosen</th></tr></thead>
    <tbody>
      <tr><td>Frontend</td><td>React 19, TypeScript, Vite</td><td>Strong type safety across board state and SSE payloads, fast builds.</td></tr>
      <tr><td>Drag &amp; Drop</td><td><code>@dnd-kit/core</code>, <code>@dnd-kit/sortable</code></td><td>Pointer + keyboard sensors with a 6px threshold so clicks still open cards.</td></tr>
      <tr><td>Backend</td><td>Node.js, Express, TypeScript</td><td>Lightweight REST routing, error middleware, and native SSE streaming.</td></tr>
      <tr><td>Database</td><td>SQLite (<code>better-sqlite3</code>)</td><td>Persistent local storage with synchronous ACID transactions and WAL mode.</td></tr>
      <tr><td>Testing</td><td>Vitest, Supertest, Testing Library, Playwright Core</td><td>Covers SQLite persistence, API validation, UI rollback, and live 2-tab sync.</td></tr>
    </tbody>
  </table>

  <h2><span class="sec-num">03</span> Architecture</h2>
  <ul>
    <li><strong>Backend (<code>server/src/</code>):</strong> <code>types.ts</code> defines task and SSE types; <code>db.ts</code> initializes SQLite and exposes <code>TaskStore</code>; <code>events.ts</code> manages SSE connections and heartbeats (<code>EventBus</code>); <code>routes.ts</code> validates payloads, handles failure injection, and maps endpoints; <code>index.ts</code> exports <code>createApp()</code> and starts the server.</li>
    <li><strong>Frontend (<code>client/src/</code>):</strong> <code>services/api.ts</code> wraps <code>fetch</code>; <code>hooks/useKanbanBoard.ts</code> handles optimistic updates, rollback, and SSE sync; <code>hooks/useUrlFilters.ts</code> syncs URL query parameters; <code>pages/BoardPage.tsx</code> and <code>components/</code> render the UI.</li>
  </ul>

  <h2><span class="sec-num">04</span> Database</h2>
  <p><code>openDatabase()</code> in <code>server/src/db.ts</code> turns on WAL mode and creates <code>tasks</code> and <code>app_metadata</code>:</p>
  <pre><code>CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
  assignee TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('Backlog', 'Todo', 'In Progress', 'Done')),
  position INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_status_position ON tasks (status, position);</code></pre>
  <p>
    Seven sample tasks are seeded once on first boot if <code>app_metadata</code> has no <code>seeded</code> key and
    <code>tasks</code> is empty. Column positions stay packed <code>0..N-1</code> inside SQLite transactions, and
    <code>bumpTimestamp()</code> ensures <code>updatedAt</code> strictly advances even on sub-millisecond updates.
  </p>

  <h2><span class="sec-num">05</span> API Implementation</h2>
  <table>
    <thead><tr><th>Endpoint</th><th>Method</th><th>Purpose</th><th>Codes</th></tr></thead>
    <tbody>
      <tr><td><code>/api/board</code></td><td>GET</td><td>Return tasks ordered by column and position</td><td><code>200</code></td></tr>
      <tr><td><code>/api/tasks</code></td><td>POST</td><td>Validate input, insert task, emit <code>task.created</code></td><td><code>201</code>, <code>400</code>, <code>503</code></td></tr>
      <tr><td><code>/api/tasks/:id</code></td><td>PATCH</td><td>Update fields, check <code>expectedUpdatedAt</code>, emit <code>task.updated</code></td><td><code>200</code>, <code>400</code>, <code>404</code>, <code>409</code>, <code>503</code></td></tr>
      <tr><td><code>/api/tasks/reorder</code></td><td>POST</td><td>Atomically move task across/within columns</td><td><code>200</code>, <code>400</code>, <code>404</code>, <code>409</code>, <code>503</code></td></tr>
      <tr><td><code>/api/tasks/:id</code></td><td>DELETE</td><td>Delete task, repack column, emit <code>task.deleted</code></td><td><code>200</code>, <code>404</code>, <code>503</code></td></tr>
      <tr><td><code>/api/events</code></td><td>GET</td><td>Open SSE stream with 25s heartbeats</td><td><code>200</code></td></tr>
      <tr><td><code>/api/health</code></td><td>GET</td><td>Return health status, SSE client count, failure flag</td><td><code>200</code></td></tr>
    </tbody>
  </table>
  <pre><code>// HTTP 409 Conflict response when expectedUpdatedAt is stale
{
  "error": {
    "code": "CONFLICT",
    "message": "This task was updated by someone else while you were editing.",
    "latestTask": { "id": "...", "title": "Winner From A", "status": "Todo", "position": 0, "updatedAt": "..." }
  }
}</code></pre>

  <h2><span class="sec-num">06</span> Frontend Implementation</h2>
  <p>
    <code>Header.tsx</code> renders the app title, live SSE status pill, browser client count, light/dark theme toggle,
    failure-simulation toggle, search box, filters, and Add Task button. <code>KanbanColumn.tsx</code> and
    <code>TaskCard.tsx</code> display the four ordered columns and cards with priority borders and badges.
    <code>CreateTaskModal.tsx</code> and <code>TaskDetailModal.tsx</code> handle validation, isolated editing drafts,
    conflict banners, and inline delete confirmation.
  </p>

  <h2><span class="sec-num">07</span> Drag-and-Drop</h2>
  <p>
    <code>BoardPage.tsx</code> configures <code>PointerSensor</code> (6px activation distance) and
    <code>KeyboardSensor</code>. <code>detectTarget()</code> checks <code>pointerWithin</code> first (favoring card
    targets over the column container) and falls back to <code>rectIntersection</code> and <code>closestCorners</code> so
    empty columns work reliably. <code>calculateReorderPlan()</code> computes indices against the full task list even
    when filters are active, then saves atomically via <code>POST /api/tasks/reorder</code>.
  </p>

  <h2><span class="sec-num">08</span> Search, Filters, and URL State</h2>
  <p>
    <code>filterTasks()</code> filters in memory by title (<code>q</code>), <code>priority</code>, and
    <code>assignee</code> simultaneously without modifying SQLite. <code>useUrlFilters()</code> reads and updates
    <code>window.location.search</code> without reloading, ignores invalid priority parameters, and listens to
    <code>popstate</code> so Back and Forward buttons restore earlier filter states.
  </p>

  <h2><span class="sec-num">09</span> Optimistic Updates</h2>
  <div class="diagram-card">
    <svg viewBox="0 0 720 125" width="100%" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="22" width="132" height="68" rx="7" fill="#eef2ff" stroke="#6366f1"/>
      <text x="76" y="48" text-anchor="middle" font-size="10" font-weight="700" fill="#1e1b4b">1. Snapshot &amp; Seq</text>
      <text x="76" y="65" text-anchor="middle" font-size="8.8" fill="#4338ca">Save affected tasks</text>
      <text x="76" y="79" text-anchor="middle" font-size="8.8" fill="#4338ca">in pendingRef</text>

      <rect x="166" y="22" width="132" height="68" rx="7" fill="#f0fdf4" stroke="#16a34a"/>
      <text x="232" y="48" text-anchor="middle" font-size="10" font-weight="700" fill="#14532d">2. Immediate UI</text>
      <text x="232" y="65" text-anchor="middle" font-size="8.8" fill="#15803d">Update board state</text>
      <text x="232" y="79" text-anchor="middle" font-size="8.8" fill="#15803d">Send REST + mutationId</text>

      <rect x="322" y="8" width="174" height="44" rx="7" fill="#ecfeff" stroke="#0891b2"/>
      <text x="409" y="27" text-anchor="middle" font-size="9.5" font-weight="700" fill="#164e63">3a. HTTP 2xx</text>
      <text x="409" y="42" text-anchor="middle" font-size="8.5" fill="#0e7490">Reconcile server response</text>

      <rect x="322" y="66" width="174" height="46" rx="7" fill="#fef2f2" stroke="#dc2626"/>
      <text x="409" y="85" text-anchor="middle" font-size="9.5" font-weight="700" fill="#7f1d1d">3b. Error / 503 / 409</text>
      <text x="409" y="100" text-anchor="middle" font-size="8.5" fill="#991b1b">Scoped rollback if seq newest</text>

      <rect x="520" y="22" width="188" height="68" rx="7" fill="#fffbeb" stroke="#d97706"/>
      <text x="614" y="48" text-anchor="middle" font-size="10" font-weight="700" fill="#78350f">4. Drain Deferred SSE</text>
      <text x="614" y="65" text-anchor="middle" font-size="8.8" fill="#92400e">Apply queued events for</text>
      <text x="614" y="79" text-anchor="middle" font-size="8.8" fill="#92400e">unlocked task IDs</text>

      <line x1="142" y1="56" x2="164" y2="56" stroke="#475569" stroke-width="1.4"/>
      <line x1="298" y1="45" x2="320" y2="30" stroke="#0891b2" stroke-width="1.4"/>
      <line x1="298" y1="68" x2="320" y2="88" stroke="#dc2626" stroke-width="1.4"/>
      <line x1="496" y1="30" x2="518" y2="46" stroke="#475569" stroke-width="1.4"/>
      <line x1="496" y1="88" x2="518" y2="68" stroke="#475569" stroke-width="1.4"/>
    </svg>
    <div class="diagram-caption">Figure 2: Optimistic mutation lifecycle and scoped rollback</div>
  </div>

  <h2><span class="sec-num">10</span> Real-Time Collaboration &amp; Timestamp Assessment</h2>
  <p>
    Each tab creates a UUID <code>clientId</code> and listens to <code>/api/events</code>. Tabs skip events carrying
    their own <code>clientId</code>. Remote events touching a task locked in <code>pendingRef</code> wait in
    <code>deferredRef</code> until the local call finishes. Open modals keep an isolated <code>draft</code> and send
    <code>expectedUpdatedAt</code> on save so stale writes return <code>409</code> and offer
    <code>Load Latest Task</code>. After a disconnect, <code>onopen</code> re-fetches <code>/api/board</code> while
    keeping pending edits intact.
  </p>
  <p>
    Remote SSE application compares <code>incoming.updatedAt &gt;= current.updatedAt</code>. Because
    <code>bumpTimestamp()</code> ensures strictly increasing ISO timestamps on a single server (and <code>&gt;=</code>
    allows sibling position shifts with unchanged timestamps to apply), this is reliable for single-instance deployment,
    though a monotonic integer <code>version</code> column would be stronger if scaled across multiple servers. Also,
    <code>moveTask</code> omits <code>expectedUpdatedAt</code>, so concurrent drags resolve as last-write-wins.
  </p>

  <h2><span class="sec-num">11</span> Testing &amp; Deployment Verification</h2>
  <table>
    <thead><tr><th>Command / Target</th><th>Coverage</th><th>Result</th></tr></thead>
    <tbody>
      <tr><td><code>npm run typecheck</code></td><td>TypeScript compilation for <code>server</code> and <code>client</code></td><td><span class="badge-pass">PASSED</span></td></tr>
      <tr><td><code>npm --workspace=server run test</code></td><td>6 tests: seed-once, CRUD/validation, 409 conflict, reorder, live SSE, 503 failure injection</td><td><span class="badge-pass">PASSED (6/6)</span></td></tr>
      <tr><td><code>npm --workspace=client run test</code></td><td>8 tests: URL sync, combined filters, theme toggle, reorder math, rollback, 409 modal, SSE</td><td><span class="badge-pass">PASSED (8/8)</span></td></tr>
      <tr><td><code>npm run build</code></td><td>Server <code>tsc</code> and Client Vite production bundle</td><td><span class="badge-pass">PASSED</span></td></tr>
      <tr><td><code>npm run test:e2e</code></td><td>9 multi-browser Edge E2E scenarios (live SSE sync, 409 conflict, drag-and-drop, refresh, rollback, reconnect)</td><td><span class="badge-pass">PASSED (9/9)</span></td></tr>
      <tr><td>Live Render URL</td><td><code>https://collaborative-kanban-board-pwxi.onrender.com/</code> (<code>/api/health</code>, <code>/api/board</code>, <code>/</code>)</td><td><span class="badge-pass">VERIFIED (200)</span></td></tr>
    </tbody>
  </table>

  <h2><span class="sec-num">12</span> Running &amp; Deploying the Application</h2>
  <pre><code># Local development
npm install
npm run dev

# Production build &amp; single-server start (Render: Build="npm install --include=dev &amp;&amp; npm run build", Start="npm run start")
npm run build
$env:SERVE_CLIENT="true"; $env:NODE_ENV="production"; npm run start</code></pre>

  <h2><span class="sec-num">13</span> Limitations and Future Improvements</h2>
  <ul>
    <li><strong>Single-node SSE &amp; SQLite:</strong> In-memory <code>EventBus</code> targets one Node process; multi-node scaling would require Redis Pub/Sub and PostgreSQL.</li>
    <li><strong>Free-tier Ephemeral Disk:</strong> Without a persistent disk mount for <code>DB_PATH</code>, SQLite resets on sleep/redeploy and re-seeds the 7 initial tasks.</li>
    <li><strong>Drag-and-Drop &amp; Auth:</strong> <code>moveTask</code> does not send <code>expectedUpdatedAt</code>; there is no user login, so client counts track open SSE tabs.</li>
  </ul>

  <h2><span class="sec-num">14</span> Final Completion Checklist</h2>
  <ul class="checklist">
    <li><span class="chk">&#10003;</span>React + TypeScript frontend</li>
    <li><span class="chk">&#10003;</span>Node.js + Express backend</li>
    <li><span class="chk">&#10003;</span>SQLite persistence</li>
    <li><span class="chk">&#10003;</span>Four ordered columns</li>
    <li><span class="chk">&#10003;</span>Create, edit, delete &amp; modal</li>
    <li><span class="chk">&#10003;</span>Drag-and-drop persistence</li>
    <li><span class="chk">&#10003;</span>Search + priority + assignee</li>
    <li><span class="chk">&#10003;</span>URL sync &amp; Back/Forward</li>
    <li><span class="chk">&#10003;</span>Optimistic updates &amp; rollback</li>
    <li><span class="chk">&#10003;</span>SSE live sync &amp; reconnect</li>
    <li><span class="chk">&#10003;</span>HTTP 409 concurrency check</li>
    <li><span class="chk">&#10003;</span>Light/dark theme toggle</li>
    <li><span class="chk">&#10003;</span>README.md &amp; .env.example</li>
    <li><span class="chk">&#10003;</span>Unit, API &amp; E2E tests passed</li>
    <li><span class="chk">&#10003;</span>Live Render URL verified</li>
    <li><span class="chk">&#10003;</span>IMPLEMENTATION_REPORT.pdf</li>
  </ul>

</body>
</html>`;

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE_PATH, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.pdf({
      path: OUTPUT_PDF,
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="width:100%;font-size:8px;color:#64748b;padding:0 16mm;display:flex;justify-content:space-between;font-family:Segoe UI,sans-serif;"><span>FlowBoard — Implementation Report</span><span>November 26, 2026</span></div>`,
      footerTemplate: `<div style="width:100%;font-size:8px;color:#64748b;padding:0 16mm;display:flex;justify-content:space-between;font-family:Segoe UI,sans-serif;"><span>Collaborative Kanban Board</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      margin: { top: '20mm', right: '16mm', bottom: '20mm', left: '16mm' },
    });
  } finally {
    await browser.close();
  }
  const stat = fs.statSync(OUTPUT_PDF);
  const header = fs.readFileSync(OUTPUT_PDF).subarray(0, 8).toString('utf8');
  console.log(`Generated ${OUTPUT_PDF} (${stat.size} bytes, header=${JSON.stringify(header)})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
