import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, User } from 'lucide-react';
import type { Task } from '../types/kanban';

type Props = {
  task: Task;
  isOverlay?: boolean;
  onSelect?: (task: Task) => void;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.length === 1
    ? parts[0].slice(0, 2).toUpperCase()
    : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function TaskCard({ task, isOverlay = false, onSelect }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'Task', task },
    disabled: isOverlay,
  });

  const style = isOverlay
    ? undefined
    : { transform: CSS.Transform.toString(transform), transition };

  const classes = [
    'task-card',
    `priority-${task.priority}`,
    isDragging && 'task-card-dragging',
    isOverlay && 'task-card-overlay',
    task.id.startsWith('temp-') && 'task-card-pending',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      ref={isOverlay ? undefined : setNodeRef}
      style={style}
      className={classes}
      data-testid={`task-card-${task.id}`}
      {...(isOverlay ? {} : attributes)}
      {...(isOverlay ? {} : listeners)}
      onClick={() => !isDragging && onSelect?.(task)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !isDragging && onSelect) {
          e.preventDefault();
          onSelect(task);
        }
      }}
    >
      <div className="task-card-top">
        <span className={`priority-badge priority-badge-${task.priority}`}>
          {task.priority}
        </span>
        <span className="drag-affordance" aria-hidden="true">
          <GripVertical size={14} />
        </span>
      </div>

      <h3 className="task-card-title">{task.title}</h3>

      <p className={task.description ? 'task-card-desc' : 'task-card-desc task-card-desc-empty'}>
        {task.description || 'No description'}
      </p>

      <div className="task-card-footer">
        <div className="assignee-chip">
          <span
            className={`avatar-badge ${task.assignee ? '' : 'avatar-unassigned'}`}
            aria-hidden="true"
          >
            {task.assignee ? initials(task.assignee) : <User size={11} />}
          </span>
          <span className={`assignee-name ${task.assignee ? '' : 'assignee-unassigned'}`}>
            {task.assignee || 'Unassigned'}
          </span>
        </div>
      </div>
    </article>
  );
}
