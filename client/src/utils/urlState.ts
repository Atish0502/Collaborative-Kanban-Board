import { PRIORITIES, type BoardFilters, type TaskPriority } from '../types/kanban';

export const DEFAULT_FILTERS: BoardFilters = {
  q: '',
  priority: 'all',
  assignee: 'all',
};

function isValidPriority(value: string): value is TaskPriority {
  return (PRIORITIES as readonly string[]).includes(value);
}

export function parseFiltersFromSearch(search: string): BoardFilters {
  const params = new URLSearchParams(search);
  const rawQ = params.get('q') ?? '';
  const rawPriority = (params.get('priority') ?? '').toLowerCase();
  const rawAssignee = (params.get('assignee') ?? '').trim();

  return {
    q: rawQ,
    priority: isValidPriority(rawPriority) ? rawPriority : 'all',
    assignee: rawAssignee.length > 0 && rawAssignee !== 'all' ? rawAssignee : 'all',
  };
}

export function buildSearchFromFilters(filters: BoardFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim().length > 0) {
    params.set('q', filters.q);
  }
  if (filters.priority !== 'all') {
    params.set('priority', filters.priority);
  }
  if (filters.assignee !== 'all' && filters.assignee.trim().length > 0) {
    params.set('assignee', filters.assignee);
  }

  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}
