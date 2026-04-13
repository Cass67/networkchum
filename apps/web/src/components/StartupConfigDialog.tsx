import { useState } from "react";
import type { NodeBootAction, NodeBootActionState } from "@networkchum/shared";

type StartupConfigDialogProps = {
  nodeId: string;
  nodeName: string;
  initialConfig: string;
  initialBootActions: Pick<
    NodeBootActionState,
    "startupConfig" | "runningConfigBackup"
  >;
  onSave: (
    nodeId: string,
    config: string,
    actions: {
      startupConfig: NodeBootAction;
      runningConfigBackup: NodeBootAction;
    },
  ) => Promise<void>;
  onClose: () => void;
};

export function StartupConfigDialog({
  nodeId,
  nodeName,
  initialConfig,
  initialBootActions,
  onSave,
  onClose,
}: StartupConfigDialogProps) {
  const [config, setConfig] = useState(initialConfig);
  const [startupConfigAction, setStartupConfigAction] = useState(
    initialBootActions.startupConfig,
  );
  const [runningConfigBackupAction, setRunningConfigBackupAction] = useState(
    initialBootActions.runningConfigBackup,
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(nodeId, config, {
        startupConfig: startupConfigAction,
        runningConfigBackup: runningConfigBackupAction,
      });
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
            <span className="field-label">Startup Config Action</span>
            <select
              className="field-input"
              aria-label="Startup Config Action"
              value={startupConfigAction}
              onChange={(event) =>
                setStartupConfigAction(event.target.value as NodeBootAction)
              }
            >
              <option value="none">No Config Inject</option>
              <option value="once">Inject Once</option>
              <option value="always">Inject Every Boot</option>
            </select>
          </label>
          <label className="field" style={{ marginTop: 0 }}>
            <span className="field-label">Running Config Backup</span>
            <select
              className="field-input"
              aria-label="Running Config Backup"
              value={runningConfigBackupAction}
              onChange={(event) =>
                setRunningConfigBackupAction(
                  event.target.value as NodeBootAction,
                )
              }
            >
              <option value="none">No Action</option>
              <option value="once">Backup Once</option>
              <option value="always">Backup Every Boot</option>
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
