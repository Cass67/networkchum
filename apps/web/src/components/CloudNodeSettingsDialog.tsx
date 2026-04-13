import { useState } from "react";

type CloudNodeSettingsDialogProps = {
  nodeId: string;
  nodeName: string;
  hostInterfaces: string[];
  initialBridgeInterface: string | null | undefined;
  onSave: (nodeId: string, bridgeInterface: string | null) => Promise<void>;
  onClose: () => void;
};

export function CloudNodeSettingsDialog({
  nodeId,
  nodeName,
  hostInterfaces,
  initialBridgeInterface,
  onSave,
  onClose,
}: CloudNodeSettingsDialogProps) {
  const [bridgeInterface, setBridgeInterface] = useState(
    initialBridgeInterface ?? "",
  );
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(nodeId, bridgeInterface || null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-label="Cloud Settings" className="dialog-overlay">
      <div className="dialog-card dialog-card--wide">
        <div className="dialog-header">
          <p className="panel-eyebrow">Cloud Settings</p>
          <h2>{nodeName}</h2>
          <p className="panel-description">
            Choose which host interface this cloud node should bridge onto.
          </p>
        </div>

        <label className="field">
          <span className="field-label">Physical Interface</span>
          <select
            className="field-input"
            aria-label="Physical Interface"
            value={bridgeInterface}
            onChange={(event) => setBridgeInterface(event.target.value)}
          >
            <option value="">No Physical Interface</option>
            {hostInterfaces.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

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
