import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardFilters, TaskPriority } from '../types/kanban';
import { buildSearchFromFilters, DEFAULT_FILTERS, parseFiltersFromSearch } from '../utils/urlState';

export function useUrlFilters() {
  const [filters, setFilters] = useState<BoardFilters>(() =>
    parseFiltersFromSearch(window.location.search)
  );
  const lastSearchPush = useRef(0);

  useEffect(() => {
    const onPopState = () => setFilters(parseFiltersFromSearch(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const setAndSync = useCallback(
    (updater: (prev: BoardFilters) => BoardFilters, isTyping = false) => {
      setFilters((prev) => {
        const next = updater(prev);
        const nextUrl = `${window.location.pathname}${buildSearchFromFilters(next)}`;
        const curUrl = `${window.location.pathname}${window.location.search}`;
        if (nextUrl !== curUrl) {
          const now = Date.now();
          if (isTyping && now - lastSearchPush.current < 600) {
            window.history.replaceState(null, '', nextUrl);
          } else {
            window.history.pushState(null, '', nextUrl);
          }
          lastSearchPush.current = isTyping ? now : 0;
        }
        return next;
      });
    },
    []
  );

  return {
    filters,
    setSearchQuery: useCallback((q: string) => setAndSync((p) => ({ ...p, q }), true), [setAndSync]),
    setPriority: useCallback(
      (priority: 'all' | TaskPriority) => setAndSync((p) => ({ ...p, priority })),
      [setAndSync]
    ),
    setAssignee: useCallback(
      (assignee: string) => setAndSync((p) => ({ ...p, assignee })),
      [setAndSync]
    ),
    clearFilters: useCallback(() => setAndSync(() => DEFAULT_FILTERS), [setAndSync]),
  };
}
