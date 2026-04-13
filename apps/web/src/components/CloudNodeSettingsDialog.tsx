import { useState } from "react";

type CloudRole = "management" | "private-circuit" | "isp-carrier";

type CloudManagementCapabilities = {
  platform: string;
  managementCloudMode?: string;
};

type CloudNodeSettingsDialogProps = {
  nodeId: string;
  nodeName: string;
  hostInterfaces: string[];
  cloudManagementCapabilities?: CloudManagementCapabilities | null;
  initialCloudRole?: CloudRole;
  initialBridgeGroup?: string | null;
  onSave: (
    nodeId: string,
    settings: { cloudRole: CloudRole; bridgeGroup: string },
  ) => Promise<void>;
  onClose: () => void;
};

export function CloudNodeSettingsDialog({
  nodeId,
  nodeName,
  hostInterfaces: _hostInterfaces,
  cloudManagementCapabilities,
  initialCloudRole,
  initialBridgeGroup,
  onSave,
  onClose,
}: CloudNodeSettingsDialogProps) {
  const [cloudRole, setCloudRole] = useState<CloudRole>(
    initialCloudRole ?? "management",
  );
  const [bridgeGroup, setBridgeGroup] = useState(
    initialBridgeGroup ??
      (initialCloudRole === "management" ? "management" : ""),
  );
  const [saving, setSaving] = useState(false);
  const showMacOsManagementSubnetGuidance =
    cloudRole === "management" &&
    cloudManagementCapabilities?.platform === "macos";

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(nodeId, {
        cloudRole,
        bridgeGroup:
          cloudRole === "management"
            ? bridgeGroup.trim() || "management"
            : bridgeGroup.trim(),
      });
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
            Choose the cloud role and bridge group NetworkChum should use for
            this cloud node.
          </p>
        </div>

        <label className="field">
          <span className="field-label">Cloud Role</span>
          <select
            className="field-input"
            aria-label="Cloud Role"
            value={cloudRole}
            onChange={(event) => {
              const nextRole = event.target.value as CloudRole;
              setCloudRole(nextRole);
              if (nextRole === "management") {
                setBridgeGroup((current) => current.trim() || "management");
                return;
              }

              setBridgeGroup((current) =>
                current === "management" ? "" : current,
              );
            }}
          >
            <option value="management">Management</option>
            <option value="private-circuit">Private Circuit</option>
            <option value="isp-carrier">ISP Carrier</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Bridge Group</span>
          <input
            className="field-input"
            aria-label="Bridge Group"
            type="text"
            value={bridgeGroup}
            onChange={(event) => setBridgeGroup(event.target.value)}
          />
        </label>
        <p className="panel-description">
          {cloudRole === "management"
            ? "Management clouds default to the shared `management` group."
            : "Clouds that share the same role and bridge group will reuse the same managed bridge."}
        </p>
        {showMacOsManagementSubnetGuidance ? (
          <p className="panel-description">
            macOS management subnet: 172.31.255.0/24 (host 172.31.255.1).
          </p>
        ) : null}

        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              void handleSave();
            }}
            disabled={
              saving || (cloudRole !== "management" && !bridgeGroup.trim())
            }
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
