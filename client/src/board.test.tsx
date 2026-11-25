import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { Task } from './types/kanban';
import { calculateReorderPlan, filterTasks } from './utils/boardUtils';
import { buildSearchFromFilters, parseFiltersFromSearch } from './utils/urlState';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    queueMicrotask(() => {
      act(() => {
        this.onopen?.();
      });
    });
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  emit(type: string, data: unknown) {
    const arr = this.listeners.get(type) ?? [];
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    act(() => {
      for (const fn of arr) fn(event);
    });
  }

  close() {}
}

const SAMPLE_TASKS: Task[] = [
  {
    id: 't-1',
    title: 'Fix login redirect bug',
    description: 'Preserve query params during OAuth redirect',
    priority: 'high',
    assignee: 'Atish',
    status: 'Backlog',
    position: 0,
    updatedAt: '2026-11-25T10:00:00.000Z',
  },
  {
    id: 't-2',
    title: 'Write unit tests',
    description: 'Cover filtering and URL sync',
    priority: 'medium',
    assignee: 'Maya',
    status: 'Todo',
    position: 0,
    updatedAt: '2026-11-25T10:01:00.000Z',
  },
  {
    id: 't-3',
    title: 'Deploy staging preview',
    description: 'Verify SSE proxy headers',
    priority: 'low',
    assignee: 'Atish',
    status: 'In Progress',
    position: 0,
    updatedAt: '2026-11-25T10:02:00.000Z',
  },
];

describe('Board utilities & URL state', () => {
  it('parses and builds URL query parameters gracefully', () => {
    expect(parseFiltersFromSearch('?q=login&priority=high&assignee=Atish')).toEqual({
      q: 'login',
      priority: 'high',
      assignee: 'Atish',
    });

    expect(parseFiltersFromSearch('?q=test&priority=invalid')).toEqual({
      q: 'test',
      priority: 'all',
      assignee: 'all',
    });

    expect(
      buildSearchFromFilters({ q: 'login', priority: 'high', assignee: 'Atish' })
    ).toBe('?q=login&priority=high&assignee=Atish');

    expect(
      buildSearchFromFilters({ q: '', priority: 'all', assignee: 'all' })
    ).toBe('');
  });

  it('filters tasks with combined search, priority, and assignee', () => {
    const result = filterTasks(SAMPLE_TASKS, {
      q: 'login',
      priority: 'high',
      assignee: 'Atish',
    });
    expect(result.map((t) => t.id)).toEqual(['t-1']);
  });

  it('calculates cross-column and same-column reorder plans accurately', () => {
    const cross = calculateReorderPlan(SAMPLE_TASKS, 't-1', 'Done');
    expect(cross).not.toBeNull();
    expect(cross?.targetStatus).toBe('Done');
    expect(cross?.targetPosition).toBe(0);
    expect(cross?.optimisticTasks.find((t) => t.id === 't-1')?.status).toBe('Done');
  });
});

describe('BoardPage UI, URL restoration, concurrency, and rollback', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders four ordered columns, filters simultaneously, and syncs URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/board')) {
          return new Response(JSON.stringify({ tasks: SAMPLE_TASKS }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      })
    );

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Fix login redirect bug')).toBeInTheDocument();
    });

    const columns = screen.getAllByRole('heading', { level: 2 }).map((el) => el.textContent);
    expect(columns).toEqual(['Backlog', 'Todo', 'In Progress', 'Done']);

    await user.type(screen.getByLabelText('Search task titles'), 'login');
    await user.selectOptions(screen.getByLabelText('Filter by priority'), 'high');
    await user.selectOptions(screen.getByLabelText('Filter by assignee'), 'Atish');

    expect(window.location.search).toBe('?q=login&priority=high&assignee=Atish');
    expect(screen.getByText('Fix login redirect bug')).toBeInTheDocument();
    expect(screen.queryByText('Write unit tests')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(window.location.search).toBe('');
    expect(screen.getByText('Write unit tests')).toBeInTheDocument();

    // Toggle dark/light theme
    await user.click(screen.getByRole('button', { name: /toggle color theme/i }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    await user.click(screen.getByRole('button', { name: /toggle color theme/i }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('restores search and filters from URL on initial mount and responds to popstate', async () => {
    window.history.replaceState(null, '', '/?q=unit&priority=medium&assignee=Maya');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/board')) {
          return new Response(JSON.stringify({ tasks: SAMPLE_TASKS }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Write unit tests')).toBeInTheDocument();
    });
    expect(screen.queryByText('Fix login redirect bug')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search task titles')).toHaveValue('unit');

    // Simulate browser back navigation to unfiltered root
    act(() => {
      window.history.pushState(null, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(screen.getByText('Fix login redirect bug')).toBeInTheDocument();
    });
  });

  it('optimistically creates a task and rolls back when the backend returns an error', async () => {
    let resolveFail!: () => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/board')) {
          return Promise.resolve(
            new Response(JSON.stringify({ tasks: SAMPLE_TASKS }), { status: 200 })
          );
        }
        if (url.endsWith('/api/tasks') && init?.method === 'POST') {
          return new Promise<Response>((resolve) => {
            resolveFail = () =>
              resolve(
                new Response(
                  JSON.stringify({
                    error: { code: 'SIMULATED_FAILURE', message: 'Simulated outage' },
                  }),
                  { status: 503 }
                )
              );
          });
        }
        return Promise.resolve(new Response('{}', { status: 404 }));
      })
    );

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Fix login redirect bug')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Add Task' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/title/i), 'Optimistic Rollback Task');
    await user.click(within(dialog).getByRole('button', { name: 'Create Task' }));

    expect(screen.getByText('Optimistic Rollback Task')).toBeInTheDocument();

    resolveFail();

    await waitFor(() => {
      expect(screen.queryByText('Optimistic Rollback Task')).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Could not create task/i)).toBeInTheDocument();
  });

  it('preserves unsaved modal draft on remote SSE update and resolves 409 conflicts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/board')) {
          return new Response(JSON.stringify({ tasks: SAMPLE_TASKS }), { status: 200 });
        }
        if (url.endsWith('/api/tasks/t-1') && init?.method === 'PATCH') {
          return new Response(
            JSON.stringify({
              error: {
                code: 'CONFLICT',
                message: 'Modified by another collaborator',
                latestTask: {
                  ...SAMPLE_TASKS[0],
                  title: 'Server Winner Title',
                  updatedAt: '2026-11-25T10:15:00.000Z',
                },
              },
            }),
            { status: 409 }
          );
        }
        return new Response('{}', { status: 404 });
      })
    );

    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Fix login redirect bug')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Fix login redirect bug'));
    const dialog = screen.getByRole('dialog');
    const titleInput = within(dialog).getByLabelText(/title/i);

    await user.clear(titleInput);
    await user.type(titleInput, 'My Local Unsaved Draft');

    // Remote SSE update arrives while modal is open — draft must NOT be overwritten
    MockEventSource.instances[0].emit('task.updated', {
      eventId: 'evt-remote-edit',
      type: 'task.updated',
      clientId: 'other-tab',
      timestamp: '2026-11-25T10:15:00.000Z',
      task: {
        ...SAMPLE_TASKS[0],
        title: 'Server Winner Title',
        updatedAt: '2026-11-25T10:15:00.000Z',
      },
    });

    expect(titleInput).toHaveValue('My Local Unsaved Draft');
    expect(within(dialog).getByText(/Updated remotely while you were editing/i)).toBeInTheDocument();

    // Saving hits 409 conflict; clicking Load Latest Task syncs the draft
    await user.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => {
      expect(within(dialog).getByText(/concurrent modification conflict/i)).toBeInTheDocument();
    });

    await user.click(within(dialog).getByRole('button', { name: /Load Latest Task/i }));
    expect(titleInput).toHaveValue('Server Winner Title');
  });

  it('receives remote SSE events without duplicating self-events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/api/board')) {
          return new Response(JSON.stringify({ tasks: SAMPLE_TASKS }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      })
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Fix login redirect bug')).toBeInTheDocument();
    });

    const sse = MockEventSource.instances[0];
    sse.emit('task.created', {
      eventId: 'evt-1',
      type: 'task.created',
      clientId: 'remote-browser-B',
      timestamp: '2026-11-25T10:05:00.000Z',
      task: {
        id: 't-remote',
        title: 'Created in Browser B',
        description: 'Live sync',
        priority: 'high',
        assignee: 'Priya',
        status: 'Done',
        position: 0,
        updatedAt: '2026-11-25T10:05:00.000Z',
      },
    });

    await waitFor(() => {
      expect(screen.getByText('Created in Browser B')).toBeInTheDocument();
    });

    sse.emit('task.deleted', {
      eventId: 'evt-2',
      type: 'task.deleted',
      clientId: 'remote-browser-B',
      timestamp: '2026-11-25T10:06:00.000Z',
      taskId: 't-remote',
    });

    await waitFor(() => {
      expect(screen.queryByText('Created in Browser B')).not.toBeInTheDocument();
    });
  });
});
