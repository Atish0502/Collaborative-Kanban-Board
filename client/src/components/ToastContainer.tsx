import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastMessage } from '../types/kanban';

type ToastContainerProps = {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
};

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => {
        const Icon =
          toast.variant === 'success'
            ? CheckCircle2
            : toast.variant === 'error'
            ? AlertCircle
            : toast.variant === 'warning'
            ? AlertTriangle
            : Info;

        return (
          <div key={toast.id} className={`toast toast-${toast.variant}`} role="status">
            <Icon size={18} className="toast-icon" />
            <div className="toast-body">
              <div className="toast-title">{toast.title}</div>
              {toast.description && <div className="toast-desc">{toast.description}</div>}
              {toast.retryAction && (
                <button
                  type="button"
                  className="toast-retry-btn"
                  onClick={() => {
                    onDismiss(toast.id);
                    toast.retryAction?.();
                  }}
                >
                  Retry
                </button>
              )}
            </div>
            <button
              type="button"
              className="toast-close-btn"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
