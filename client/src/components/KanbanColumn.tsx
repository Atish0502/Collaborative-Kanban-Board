import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus } from 'lucide-react';
import type { Task, TaskStatus } from '../types/kanban';
import { TaskCard } from './TaskCard';

type Props = {
  status: TaskStatus;
  tasks: Task[];
  totalCountInColumn: number;
  isFiltered: boolean;
  onAddTask: (status: TaskStatus) => void;
  onSelectTask: (task: Task) => void;
};

const DOT_CLASS: Record<TaskStatus, string> = {
  Backlog: 'col-dot-backlog',
  Todo: 'col-dot-todo',
  'In Progress': 'col-dot-progress',
  Done: 'col-dot-done',
};

export function KanbanColumn({
  status,
  tasks,
  totalCountInColumn,
  isFiltered,
  onAddTask,
  onSelectTask,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { type: 'Column', status } });

  return (
    <section
      className={`kanban-column ${isOver ? 'kanban-column-over' : ''}`}
      aria-label={`${status} column`}
      data-testid={`column-${status}`}
    >
      <div className="column-header">
        <div className="column-title-group">
          <span className={`column-dot ${DOT_CLASS[status]}`} aria-hidden="true" />
          <h2 className="column-title">{status}</h2>
          <span className="column-count">
            {isFiltered && totalCountInColumn !== tasks.length
              ? `${tasks.length}/${totalCountInColumn}`
              : tasks.length}
          </span>
        </div>

        <button
          type="button"
          className="column-add-btn"
          onClick={() => onAddTask(status)}
          aria-label={`Add task to ${status}`}
        >
          <Plus size={16} />
        </button>
      </div>

      <div ref={setNodeRef} className="column-body">
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? (
            <div className="column-empty">
              <p className="column-empty-text">
                {isFiltered ? 'No matching tasks' : `No tasks in ${status}`}
              </p>
              {!isFiltered && (
                <button type="button" className="column-empty-cta" onClick={() => onAddTask(status)}>
                  + Add a task
                </button>
              )}
            </div>
          ) : (
            <div className="task-list">
              {tasks.map((task) => (
                <TaskCard key={task.id} task={task} onSelect={onSelectTask} />
              ))}
            </div>
          )}
        </SortableContext>
      </div>
    </section>
  );
}
