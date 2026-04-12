import { useState } from "react";
import type { NodeBootAction } from "@networkchum/shared";

type StartupConfigDialogProps = {
  nodeId: string;
  nodeName: string;
  initialConfig: string;
  initialBootAction: NodeBootAction;
  onSave: (
    nodeId: string,
    config: string,
    action: NodeBootAction,
  ) => Promise<void>;
  onClose: () => void;
};

export function StartupConfigDialog({
  nodeId,
  nodeName,
  initialConfig,
  initialBootAction,
  onSave,
  onClose,
}: StartupConfigDialogProps) {
  const [config, setConfig] = useState(initialConfig);
  const [bootAction, setBootAction] = useState(initialBootAction);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(nodeId, config, bootAction);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-label="Startup Config" className="dialog-overlay">
      <div
        className="dialog-card dialog-card--wide"
        style={{
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div className="dialog-header">
          <p className="panel-eyebrow">Startup Config</p>
          <h2>{nodeName}</h2>
          <p className="panel-description">
            Saved as a cdrom drive attached on power-on.
          </p>
          <label className="field" style={{ marginTop: 0 }}>
            <span className="field-label">Next Power-Up Action</span>
            <select
              className="field-input"
              aria-label="Next Power-Up Action"
              value={bootAction}
              onChange={(event) =>
                setBootAction(event.target.value as NodeBootAction)
              }
            >
              <option value="none">No Boot Action</option>
              <option value="backup-once">Backup Running Config Once</option>
              <option value="inject-once">Inject Startup Config Once</option>
            </select>
          </label>
        </div>
        <textarea
          className="field-input"
          style={{
            flexGrow: 1,
            minHeight: 320,
            fontFamily: "monospace",
            fontSize: 12,
            resize: "vertical",
            whiteSpace: "pre",
          }}
          value={config}
          onChange={(e) => setConfig(e.target.value)}
          placeholder="Paste startup config here..."
          spellCheck={false}
        />
        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
