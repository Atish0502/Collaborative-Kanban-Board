import { AlertTriangle, FilterX, Moon, Plus, Search, Sun, Users, Wifi, WifiOff, X } from 'lucide-react';
import type { BoardFilters, ConnectionStatus, TaskPriority } from '../types/kanban';
import { hasActiveFilters } from '../utils/boardUtils';

type Props = {
  filters: BoardFilters;
  assignees: string[];
  connectionStatus: ConnectionStatus;
  connectedClients: number;
  simulateFailure: boolean;
  theme: 'light' | 'dark';
  onSearchChange: (q: string) => void;
  onPriorityChange: (priority: 'all' | TaskPriority) => void;
  onAssigneeChange: (assignee: string) => void;
  onClearFilters: () => void;
  onToggleSimulateFailure: () => void;
  onToggleTheme: () => void;
  onOpenCreateModal: () => void;
};

export function Header({
  filters,
  assignees,
  connectionStatus,
  connectedClients,
  simulateFailure,
  theme,
  onSearchChange,
  onPriorityChange,
  onAssigneeChange,
  onClearFilters,
  onToggleSimulateFailure,
  onToggleTheme,
  onOpenCreateModal,
}: Props) {
  const statusText =
    connectionStatus === 'connected'
      ? 'Live'
      : connectionStatus === 'connecting'
      ? 'Connecting'
      : 'Reconnecting';

  return (
    <header className="board-header">
      <div className="header-top">
        <div className="brand-group">
          <div className="brand-logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="4" width="4.5" height="16" rx="1.5" fill="currentColor" />
              <rect x="9.75" y="4" width="4.5" height="10.5" rx="1.5" fill="currentColor" opacity="0.82" />
              <rect x="16.5" y="4" width="4.5" height="13.5" rx="1.5" fill="currentColor" opacity="0.64" />
            </svg>
          </div>
          <div className="brand-title-row">
            <span className="app-name">FlowBoard</span>
            <span className="board-divider">/</span>
            <h1 className="board-title">Product Engineering Sprint</h1>
          </div>
        </div>

        <div className="header-status-actions">
          <div className={`connection-pill connection-${connectionStatus}`} role="status">
            {connectionStatus === 'reconnecting' ? <WifiOff size={14} /> : <Wifi size={14} />}
            <span className="connection-dot" />
            <span>{statusText}</span>
          </div>

          <div
            className="clients-pill"
            title="Connected browser tabs/clients (not authenticated user accounts)"
          >
            <Users size={14} />
            <span>{connectedClients} {connectedClients === 1 ? 'client' : 'clients'}</span>
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sim"
            onClick={onToggleTheme}
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>

          <button
            type="button"
            className={`btn btn-ghost btn-sim ${simulateFailure ? 'btn-sim-active' : ''}`}
            onClick={onToggleSimulateFailure}
            aria-pressed={simulateFailure}
          >
            <AlertTriangle size={14} />
            <span>{simulateFailure ? 'Simulating Failures' : 'Simulate Failure'}</span>
          </button>

          <button type="button" className="btn btn-primary" onClick={onOpenCreateModal}>
            <Plus size={16} />
            <span>Add Task</span>
          </button>
        </div>
      </div>

      <div className="header-toolbar">
        <div className="search-field">
          <Search size={15} className="search-icon" aria-hidden="true" />
          <input
            type="search"
            className="search-input"
            placeholder="Search task titles..."
            aria-label="Search task titles"
            value={filters.q}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {filters.q && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="filter-controls">
          <label className="filter-label">
            <span className="filter-caption">Priority</span>
            <select
              className="filter-select"
              aria-label="Filter by priority"
              value={filters.priority}
              onChange={(e) => onPriorityChange(e.target.value as 'all' | TaskPriority)}
            >
              <option value="all">All priorities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>

          <label className="filter-label">
            <span className="filter-caption">Assignee</span>
            <select
              className="filter-select"
              aria-label="Filter by assignee"
              value={filters.assignee}
              onChange={(e) => onAssigneeChange(e.target.value)}
            >
              <option value="all">All assignees</option>
              {assignees.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>

          {hasActiveFilters(filters) && (
            <button type="button" className="btn btn-ghost btn-clear-filters" onClick={onClearFilters}>
              <FilterX size={14} />
              <span>Clear filters</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
