import { X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { CreateTaskPayload } from '../services/api';
import { COLUMNS, PRIORITIES, type TaskPriority, type TaskStatus } from '../types/kanban';

type Props = {
  isOpen: boolean;
  defaultStatus: TaskStatus;
  onClose: () => void;
  onCreate: (payload: CreateTaskPayload) => Promise<void>;
};

export function CreateTaskModal({ isOpen, defaultStatus, onClose, onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assignee, setAssignee] = useState('');
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTitle('');
    setDescription('');
    setPriority('medium');
    setAssignee('');
    setStatus(defaultStatus);
    setError(null);
    setSaving(false);
  }, [isOpen, defaultStatus]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Task title is required.');
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim(),
        priority,
        assignee: assignee.trim(),
        status,
      });
    } catch {
      // rollback and error toast are handled by useKanbanBoard
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-task-title" onClick={() => !saving && onClose()}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="create-task-title" className="modal-title">Create New Task</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={saving} aria-label="Close modal">
            <X size={18} />
          </button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit}>
          {error && <div className="form-error-banner" role="alert">{error}</div>}

          <div className="form-group">
            <label htmlFor="create-title" className="form-label">Title <span className="required-mark">*</span></label>
            <input
              id="create-title"
              type="text"
              className="form-input"
              placeholder="e.g., Implement token refresh retry"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="create-description" className="form-label">Description</label>
            <textarea
              id="create-description"
              className="form-textarea"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="create-status" className="form-label">Column</label>
              <select id="create-status" className="form-select" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                {COLUMNS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="create-priority" className="form-label">Priority</label>
              <select id="create-priority" className="form-select" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="create-assignee" className="form-label">Assignee</label>
            <input
              id="create-assignee"
              type="text"
              className="form-input"
              placeholder="e.g., Atish, Maya, Priya"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              maxLength={100}
            />
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !title.trim()}>
              {saving ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
