import { AlertCircle, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, type UpdateTaskPayload } from '../services/api';
import { COLUMNS, PRIORITIES, type Task, type TaskPriority, type TaskStatus } from '../types/kanban';

type Props = {
  taskId: string | null;
  liveTask: Task | null;
  onClose: () => void;
  onSave: (id: string, payload: UpdateTaskPayload) => Promise<Task>;
  onDelete: (id: string) => Promise<void>;
};

type Draft = {
  title: string;
  description: string;
  priority: TaskPriority;
  assignee: string;
  status: TaskStatus;
};

export function TaskDetailModal({ taskId, liveTask, onClose, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Task | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // Only reset draft when opening a new task so live SSE updates do not overwrite edits.
  useEffect(() => {
    if (!taskId || !liveTask) {
      setDraft(null);
      setBaseUpdatedAt('');
      setError(null);
      setConflict(null);
      setConfirmDelete(false);
      return;
    }
    setDraft({
      title: liveTask.title,
      description: liveTask.description,
      priority: liveTask.priority,
      assignee: liveTask.assignee,
      status: liveTask.status,
    });
    setBaseUpdatedAt(liveTask.updatedAt);
    setError(null);
    setConflict(null);
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [taskId, busy, onClose]);

  if (!taskId || !draft) return null;

  const loadLatest = (latest: Task) => {
    setDraft({
      title: latest.title,
      description: latest.description,
      priority: latest.priority,
      assignee: latest.assignee,
      status: latest.status,
    });
    setBaseUpdatedAt(latest.updatedAt);
    setConflict(null);
    setError(null);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) {
      setError('Task title cannot be empty.');
      return;
    }
    setBusy(true);
    try {
      await onSave(taskId, {
        title: draft.title.trim(),
        description: draft.description,
        priority: draft.priority,
        assignee: draft.assignee.trim(),
        status: draft.status,
        expectedUpdatedAt: baseUpdatedAt,
      });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409 && err.latestTask) {
        setConflict(err.latestTask);
      } else {
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await onDelete(taskId);
    } catch {
      // rollback and error toast are handled by useKanbanBoard
    } finally {
      setBusy(false);
      onClose();
    }
  };

  const remoteChanged = Boolean(liveTask && baseUpdatedAt && liveTask.updatedAt !== baseUpdatedAt);
  const bannerTask = conflict || (remoteChanged ? liveTask : null);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="edit-task-title" onClick={() => !busy && onClose()}>
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 id="edit-task-title" className="modal-title">Task Details</h2>
            {liveTask && <p className="modal-subtitle">Last updated {new Date(liveTask.updatedAt).toLocaleString()}</p>}
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Close task details">
            <X size={18} />
          </button>
        </div>

        {!liveTask ? (
          <div className="modal-form">
            <div className="conflict-banner conflict-banner-danger" role="alert">
              <AlertCircle size={18} />
              <div>
                <strong>This task was deleted by another user.</strong>
                <p>Your local draft is kept below if you want to copy it.</p>
              </div>
            </div>
            <input type="text" className="form-input" value={draft.title} readOnly />
            <textarea className="form-textarea" rows={3} value={draft.description} readOnly />
            <div className="modal-footer">
              <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
            </div>
          </div>
        ) : (
          <form className="modal-form" onSubmit={handleSave}>
            {bannerTask && (
              <div className="conflict-banner" role="alert">
                <AlertCircle size={18} />
                <div className="conflict-banner-body">
                  <strong>
                    {conflict
                      ? 'Save blocked: concurrent modification conflict (HTTP 409)'
                      : 'Updated remotely while you were editing'}
                  </strong>
                  <p>Latest server title: <em>&ldquo;{bannerTask.title}&rdquo;</em> ({bannerTask.status})</p>
                  <button type="button" className="btn btn-sm btn-warning-outline" onClick={() => loadLatest(bannerTask)}>
                    <RefreshCw size={13} />
                    <span>Load Latest Task</span>
                  </button>
                </div>
              </div>
            )}

            {error && <div className="form-error-banner" role="alert">{error}</div>}

            <div className="form-group">
              <label htmlFor="edit-title" className="form-label">Title <span className="required-mark">*</span></label>
              <input
                id="edit-title"
                type="text"
                className="form-input"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                maxLength={200}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-description" className="form-label">Description</label>
              <textarea
                id="edit-description"
                className="form-textarea"
                rows={4}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                maxLength={4000}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="edit-status" className="form-label">Column</label>
                <select id="edit-status" className="form-select" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as TaskStatus })}>
                  {COLUMNS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="edit-priority" className="form-label">Priority</label>
                <select id="edit-priority" className="form-select" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}>
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="edit-assignee" className="form-label">Assignee</label>
              <input
                id="edit-assignee"
                type="text"
                className="form-input"
                value={draft.assignee}
                onChange={(e) => setDraft({ ...draft, assignee: e.target.value })}
                maxLength={100}
              />
            </div>

            <div className="modal-footer modal-footer-split">
              <div className="delete-zone">
                {!confirmDelete ? (
                  <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
                    <Trash2 size={15} />
                    <span>Delete</span>
                  </button>
                ) : (
                  <div className="delete-confirm-inline">
                    <span className="delete-confirm-label">Delete this task?</span>
                    <button type="button" className="btn btn-danger btn-sm" onClick={handleDelete} disabled={busy}>
                      {busy ? 'Deleting...' : 'Confirm Delete'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(false)} disabled={busy}>
                      Keep
                    </button>
                  </div>
                )}
              </div>

              <div className="modal-actions-right">
                <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy || !draft.title.trim()}>
                  {busy ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
