import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function waitForServer(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // Server still booting
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not become ready at ${url} within ${timeoutMs}ms`);
}

async function dragElementTo(page, sourceLocator, targetLocator) {
  await sourceLocator.scrollIntoViewIfNeeded();
  await targetLocator.scrollIntoViewIfNeeded();
  const sourceBox = await sourceLocator.boundingBox();
  const targetBox = await targetLocator.boundingBox();
  if (!sourceBox || !targetBox) {
    throw new Error('Could not resolve bounding box for drag-and-drop');
  }

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + Math.min(targetBox.height / 2, 120);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, startY + 8, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.waitForTimeout(120);
  await page.mouse.up();
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-e2e-'));
  const dbPath = path.join(tmpDir, 'e2e-kanban.db');

  const serverProc = spawn('node', ['server/dist/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      DB_PATH: dbPath,
      SERVE_CLIENT: 'true',
      CORS_ORIGIN: BASE_URL,
      FAILURE_INJECTION_ENABLED: 'false',
      ALLOW_FAILURE_INJECTION_HEADER: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let browser;
  const results = [];
  const record = (name, status) => {
    results.push({ name, status });
    console.log(`[E2E] ${status}: ${name}`);
  };

  try {
    await waitForServer(BASE_URL);
    browser = await chromium.launch({
      executablePath: EDGE_PATH,
      headless: true,
    });

    const contextA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const contextB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await Promise.all([pageA.goto(BASE_URL), pageB.goto(BASE_URL)]);

    // 1. Verify initial board load, 4 ordered columns, and SSE live status
    await pageA.locator('[data-testid^="task-card-"]').first().waitFor({ timeout: 10000 });
    await pageB.locator('[data-testid^="task-card-"]').first().waitFor({ timeout: 10000 });

    const headingsA = await pageA.locator('h2.column-title').allTextContents();
    assert(
      JSON.stringify(headingsA) === JSON.stringify(['Backlog', 'Todo', 'In Progress', 'Done']),
      `Unexpected column order: ${JSON.stringify(headingsA)}`
    );
    await pageA.getByText('Live').waitFor({ timeout: 5000 });
    await pageB.getByText('2 clients').waitFor({ timeout: 5000 });
    record('1. Initial board load, 4 ordered columns, and 2 live SSE clients', 'PASS');

    // 2. Create in Browser A -> appears in Browser B via SSE
    await pageA.getByRole('button', { name: 'Add Task', exact: true }).click();
    const createDialog = pageA.getByRole('dialog');
    await createDialog.getByLabel(/Title/i).fill('E2E Realtime Task');
    await createDialog.getByLabel(/Description/i).fill('Created in Browser A for SSE sync');
    await createDialog.getByLabel(/Column/i).selectOption('Todo');
    await createDialog.getByLabel(/Priority/i).selectOption('high');
    await createDialog.getByLabel(/Assignee/i).fill('Atish');
    await createDialog.getByRole('button', { name: 'Create Task', exact: true }).click();

    await pageA.locator('h3.task-card-title', { hasText: 'E2E Realtime Task' }).waitFor({ timeout: 5000 });
    await pageB.locator('h3.task-card-title', { hasText: 'E2E Realtime Task' }).waitFor({ timeout: 5000 });
    record('2. Create task in Browser A propagates to Browser B via SSE', 'PASS');

    // 3. Edit in Browser A -> appears in Browser B via SSE
    await pageA.locator('h3.task-card-title', { hasText: 'E2E Realtime Task' }).click();
    const editDialogA = pageA.getByRole('dialog');
    await editDialogA.getByLabel(/Title/i).fill('E2E Updated Task');
    await editDialogA.getByRole('button', { name: 'Save Changes', exact: true }).click();

    await pageB.locator('h3.task-card-title', { hasText: 'E2E Updated Task' }).waitFor({ timeout: 5000 });
    record('3. Edit task in Browser A propagates to Browser B via SSE', 'PASS');

    // 4. Concurrent edit conflict (HTTP 409)
    await pageB.locator('h3.task-card-title', { hasText: 'E2E Updated Task' }).click();
    const editDialogB = pageB.getByRole('dialog');
    await editDialogB.getByLabel(/Title/i).fill('Stale Draft From B');

    await pageA.locator('h3.task-card-title', { hasText: 'E2E Updated Task' }).click();
    const editDialogA2 = pageA.getByRole('dialog');
    await editDialogA2.getByLabel(/Title/i).fill('Winner From A');
    await editDialogA2.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await pageA.locator('h3.task-card-title', { hasText: 'Winner From A' }).waitFor({ timeout: 5000 });

    // B should still retain its unsaved draft and show remote update notice, then 409 on save
    await editDialogB.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await editDialogB.getByText(/HTTP 409/i).waitFor({ timeout: 5000 });
    await editDialogB.getByRole('button', { name: /Load Latest Task/i }).click();
    const syncedValue = await editDialogB.getByLabel(/Title/i).inputValue();
    assert(syncedValue === 'Winner From A', `Expected Winner From A, got ${syncedValue}`);
    await editDialogB.getByRole('button', { name: 'Cancel', exact: true }).click();
    record('4. Concurrent edit conflict detection (HTTP 409) and reload latest task', 'PASS');

    // 5. Drag-and-drop cross-column (Todo -> Done) + persistence + SSE to B
    const cardInA = pageA.locator('[data-testid^="task-card-"]', { hasText: 'Winner From A' });
    const doneColumnA = pageA.getByTestId('column-Done');
    await dragElementTo(pageA, cardInA, doneColumnA);

    await pageA
      .getByTestId('column-Done')
      .locator('h3.task-card-title', { hasText: 'Winner From A' })
      .waitFor({ timeout: 5000 });
    await pageB
      .getByTestId('column-Done')
      .locator('h3.task-card-title', { hasText: 'Winner From A' })
      .waitFor({ timeout: 5000 });

    await pageA.reload();
    await pageA
      .getByTestId('column-Done')
      .locator('h3.task-card-title', { hasText: 'Winner From A' })
      .waitFor({ timeout: 5000 });
    record('5. Cross-column drag-and-drop persists in SQLite and syncs to Browser B', 'PASS');

    // 6. Combined search + priority + assignee + URL persistence across refresh + back
    await pageA.getByLabel('Search task titles').fill('Winner');
    await pageA.getByLabel('Filter by priority').selectOption('high');
    await pageA.getByLabel('Filter by assignee').selectOption('Atish');

    await pageA.waitForFunction(
      () => window.location.search === '?q=Winner&priority=high&assignee=Atish'
    );
    await pageA.reload();
    await pageA.locator('h3.task-card-title', { hasText: 'Winner From A' }).waitFor({ timeout: 5000 });
    const searchVal = await pageA.getByLabel('Search task titles').inputValue();
    assert(searchVal === 'Winner', `Expected persisted search "Winner", got "${searchVal}"`);

    await pageA.getByRole('button', { name: /Clear filters/i }).click();
    await pageA.waitForFunction(() => window.location.search === '');
    record('6. Combined filtering and URL query state persistence across refresh', 'PASS');

    // 7. Failure injection & optimistic rollback
    await pageA.getByRole('button', { name: /Simulate Failure/i }).click();
    await pageA.getByRole('button', { name: 'Add Task', exact: true }).click();
    const failDialog = pageA.getByRole('dialog');
    await failDialog.getByLabel(/Title/i).fill('Should Rollback Card');
    await failDialog.getByRole('button', { name: 'Create Task', exact: true }).click();

    await pageA.getByText(/Could not create task/i).waitFor({ timeout: 5000 });
    const rollbackCountA = await pageA.locator('h3.task-card-title', { hasText: 'Should Rollback Card' }).count();
    const rollbackCountB = await pageB.locator('h3.task-card-title', { hasText: 'Should Rollback Card' }).count();
    assert(rollbackCountA === 0 && rollbackCountB === 0, 'Failed task was not rolled back');
    await pageA.getByRole('button', { name: /Simulating Failures/i }).click();
    record('7. Simulated API failure triggers optimistic rollback and error toast', 'PASS');

    // 8. Delete in Browser A -> removed in Browser B
    await pageA.locator('h3.task-card-title', { hasText: 'Winner From A' }).click();
    const delDialog = pageA.getByRole('dialog');
    await delDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await delDialog.getByRole('button', { name: 'Confirm Delete', exact: true }).click();

    await pageA.waitForFunction(
      () => !Array.from(document.querySelectorAll('h3.task-card-title')).some((el) => el.textContent === 'Winner From A')
    );
    await pageB.waitForFunction(
      () => !Array.from(document.querySelectorAll('h3.task-card-title')).some((el) => el.textContent === 'Winner From A')
    );
    record('8. Delete task in Browser A removes task in Browser B via SSE', 'PASS');

    // 9. Offline/disconnect -> missed update -> reconnect reconciliation
    await contextB.setOffline(true);
    await pageA.getByRole('button', { name: 'Add Task', exact: true }).click();
    const offlineDialog = pageA.getByRole('dialog');
    await offlineDialog.getByLabel(/Title/i).fill('Synced After Reconnect');
    await offlineDialog.getByRole('button', { name: 'Create Task', exact: true }).click();
    await pageA.locator('h3.task-card-title', { hasText: 'Synced After Reconnect' }).waitFor({ timeout: 5000 });

    await contextB.setOffline(false);
    await pageB.locator('h3.task-card-title', { hasText: 'Synced After Reconnect' }).waitFor({ timeout: 12000 });
    record('9. Disconnected client reconnects and reconciles missed tasks', 'PASS');

    console.log('\nAll 9 end-to-end multi-browser tests PASSED!');
  } catch (err) {
    console.error('[E2E TEST FAILURE]', err);
    throw err;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (!serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000);
      serverProc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup on Windows
    }
  }
}

main().catch((err) => {
  console.error('[E2E ERROR]', err);
  process.exit(1);
});
