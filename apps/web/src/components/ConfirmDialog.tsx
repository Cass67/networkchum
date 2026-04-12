type ConfirmDialogProps = {
  open: boolean;
  title: string;
  body: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  body,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div role="dialog" aria-label={title} className="dialog-overlay">
      <div className="dialog-card dialog-card--compact">
        <div className="dialog-header">
          <p className="panel-eyebrow">Confirm</p>
          <h2>{title}</h2>
        </div>
        <p>{body}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
