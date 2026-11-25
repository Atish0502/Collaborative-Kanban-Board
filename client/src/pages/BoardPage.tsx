import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { RefreshCw, ServerCrash } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CreateTaskModal } from '../components/CreateTaskModal';
import { Header } from '../components/Header';
import { KanbanColumn } from '../components/KanbanColumn';
import { TaskCard } from '../components/TaskCard';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { ToastContainer } from '../components/ToastContainer';
import { useKanbanBoard } from '../hooks/useKanbanBoard';
import { useUrlFilters } from '../hooks/useUrlFilters';
import { COLUMNS, type Task, type TaskStatus } from '../types/kanban';
import { filterTasks, getTasksByColumn, getUniqueAssignees, hasActiveFilters } from '../utils/boardUtils';

const detectTarget: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length > 0) {
    const card = hits.find((h) => !(COLUMNS as readonly string[]).includes(String(h.id)));
    return card ? [card] : hits;
  }
  const rect = rectIntersection(args);
  return rect.length > 0 ? rect : closestCorners(args);
};

export function BoardPage() {
  const board = useKanbanBoard();
  const { filters, setSearchQuery, setPriority, setAssignee, clearFilters } = useUrlFilters();

  const [createStatus, setCreateStatus] = useState<TaskStatus>('Backlog');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const assignees = useMemo(() => getUniqueAssignees(board.tasks), [board.tasks]);
  const visibleTasks = useMemo(() => filterTasks(board.tasks, filters), [board.tasks, filters]);
  const isFiltered = hasActiveFilters(filters);
  const selectedTask = useMemo(
    () => (selectedId ? board.tasks.find((t) => t.id === selectedId) ?? null : null),
    [board.tasks, selectedId]
  );

  const openCreate = (status: TaskStatus = 'Backlog') => {
    setCreateStatus(status);
    setIsCreateOpen(true);
  };

  const onDragStart = (e: DragStartEvent) => {
    setDraggingTask(board.tasks.find((t) => t.id === String(e.active.id)) ?? null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDraggingTask(null);
    if (!e.over) return;
    const activeId = String(e.active.id);
    const overId = String(e.over.id);
    if (activeId !== overId) void board.moveTask(activeId, overId);
  };

  return (
    <div className="app-shell">
      <Header
        filters={filters}
        assignees={assignees}
        connectionStatus={board.connectionStatus}
        connectedClients={board.connectedClients}
        simulateFailure={board.simulateFailure}
        theme={theme}
        onSearchChange={setSearchQuery}
        onPriorityChange={setPriority}
        onAssigneeChange={setAssignee}
        onClearFilters={clearFilters}
        onToggleSimulateFailure={() => board.setSimulateFailure((v) => !v)}
        onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        onOpenCreateModal={() => openCreate('Backlog')}
      />

      <main className="board-main">
        {board.isLoading ? (
          <div className="board-state-panel" role="status">
            <div className="spinner" aria-hidden="true" />
            <p className="state-title">Loading collaborative board...</p>
          </div>
        ) : board.loadError && board.tasks.length === 0 ? (
          <div className="board-state-panel board-state-error" role="alert">
            <ServerCrash size={36} className="state-error-icon" />
            <p className="state-title">Unable to connect to the Kanban backend</p>
            <p className="state-desc">{board.loadError}</p>
            <button type="button" className="btn btn-primary" onClick={() => void board.reloadBoard()}>
              <RefreshCw size={15} />
              <span>Retry Connection</span>
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={detectTarget}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDraggingTask(null)}
          >
            <div className="board-grid">
              {COLUMNS.map((status) => (
                <KanbanColumn
                  key={status}
                  status={status}
                  tasks={getTasksByColumn(visibleTasks, status)}
                  totalCountInColumn={getTasksByColumn(board.tasks, status).length}
                  isFiltered={isFiltered}
                  onAddTask={openCreate}
                  onSelectTask={(t) => setSelectedId(t.id)}
                />
              ))}
            </div>

            <DragOverlay dropAnimation={null}>
              {draggingTask ? <TaskCard task={draggingTask} isOverlay /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      <CreateTaskModal
        isOpen={isCreateOpen}
        defaultStatus={createStatus}
        onClose={() => setIsCreateOpen(false)}
        onCreate={async (payload) => {
          await board.createTask(payload);
        }}
      />

      <TaskDetailModal
        taskId={selectedId}
        liveTask={selectedTask}
        onClose={() => setSelectedId(null)}
        onSave={board.updateTask}
        onDelete={board.deleteTask}
      />

      <ToastContainer toasts={board.toasts} onDismiss={board.dismissToast} />
    </div>
  );
}
