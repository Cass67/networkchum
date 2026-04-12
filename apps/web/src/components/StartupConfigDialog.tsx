import { useState } from "react";

type StartupConfigDialogProps = {
  nodeId: string;
  nodeName: string;
  initialConfig: string;
  onSave: (nodeId: string, config: string) => Promise<void>;
  onClose: () => void;
};

export function StartupConfigDialog({
  nodeId,
  nodeName,
  initialConfig,
  onSave,
  onClose,
}: StartupConfigDialogProps) {
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(nodeId, config);
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
