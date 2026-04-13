import { useState } from "react";

type CloudRole = "management" | "private-circuit" | "isp-carrier";

type CloudManagementCapabilities = {
  platform: string;
  managementCloudMode?: string;
};

type TemplateEntry = {
  id: string;
  name: string;
  source: string;
  runtime?: string;
  configSchema?: {
    interfaceCount: { default: number; min: number; max: number };
  };
};

type ExistingNode = {
  id: string;
  name: string;
  position?: { x: number; y: number };
};

type AddNodeDialogProps = {
  templates: TemplateEntry[];
  existingNodes: ExistingNode[];
  cloudManagementCapabilities?: CloudManagementCapabilities | null;
  onSubmit: (input: {
    templateId: string;
    name: string;
    position: { x: number; y: number };
    interfaceCount?: number;
    cloudRole?: CloudRole;
    bridgeGroup?: string | null;
  }) => Promise<void>;
  hostInterfaces: string[];
  onCancel: () => void;
};

function computeNextPosition(existingNodes: ExistingNode[]): {
  x: number;
  y: number;
} {
  const gridSize = 120;
  const padding = 40;

  if (existingNodes.length === 0) {
    return { x: padding, y: padding };
  }

  const occupied = new Set(
    existingNodes
      .filter((n) => n.position)
      .map(
        (n) =>
          `${Math.round((n.position!.x - padding) / gridSize)},${Math.round((n.position!.y - padding) / gridSize)}`,
      ),
  );

  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 10; col++) {
      if (!occupied.has(`${col},${row}`)) {
        return { x: padding + col * gridSize, y: padding + row * gridSize };
      }
    }
  }

  return { x: padding + existingNodes.length * gridSize, y: padding };
}

export function AddNodeDialog({
  templates,
  existingNodes,
  hostInterfaces: _hostInterfaces,
  cloudManagementCapabilities,
  onSubmit,
  onCancel,
}: AddNodeDialogProps) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [name, setName] = useState(() => {
    const base =
      templates[0]?.id
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/ /g, "-") ?? "node";
    return `${base}-${existingNodes.length + 1}`;
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedTemplate = templates.find(
    (template) => template.id === templateId,
  );
  const interfaceRange = selectedTemplate?.configSchema?.interfaceCount;
  const showInterfaceCount =
    interfaceRange !== undefined && interfaceRange.min !== interfaceRange.max;
  const [interfaceCount, setInterfaceCount] = useState(
    templates[0]?.configSchema?.interfaceCount.default,
  );
  const showCloudBridgeSettings = selectedTemplate?.runtime === "cloud";
  const [cloudRole, setCloudRole] = useState<CloudRole>("management");
  const [bridgeGroup, setBridgeGroup] = useState("management");
  const showMacOsManagementSubnetGuidance =
    showCloudBridgeSettings &&
    cloudRole === "management" &&
    cloudManagementCapabilities?.platform === "macos";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const position = computeNextPosition(existingNodes);
      await onSubmit({
        templateId,
        name,
        position,
        interfaceCount: showInterfaceCount ? interfaceCount : undefined,
        cloudRole: showCloudBridgeSettings ? cloudRole : undefined,
        bridgeGroup: showCloudBridgeSettings
          ? cloudRole === "management"
            ? bridgeGroup.trim() || "management"
            : bridgeGroup.trim() || null
          : undefined,
      });
    } catch {
      setError("Failed to add node");
    } finally {
      setSubmitting(false);
    }
  }

  function handleTemplateChange(newTemplateId: string) {
    setTemplateId(newTemplateId);
    const template = templates.find((t) => t.id === newTemplateId);
    if (template) {
      setInterfaceCount(template.configSchema?.interfaceCount.default);
      setCloudRole("management");
      setBridgeGroup("management");
      const base = template.id
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .replace(/ /g, "-");
      setName(`${base}-${existingNodes.length + 1}`);
    }
  }

  return (
    <div className="dialog-overlay" data-testid="add-node-dialog-overlay">
      <div className="dialog-card" role="dialog" aria-label="Add Node">
        <div className="dialog-header">
          <p className="panel-eyebrow">Topology</p>
          <h2>Add Node</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>
              <span className="field-label">Template</span>
              <select
                value={templateId}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="field-input"
                data-testid="template-select"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <label>
              <span className="field-label">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field-input"
                data-testid="node-name-input"
              />
            </label>
          </div>
          {showInterfaceCount && interfaceRange ? (
            <div className="field">
              <label>
                <span className="field-label">Interfaces</span>
                <input
                  type="number"
                  min={interfaceRange.min}
                  max={interfaceRange.max}
                  value={interfaceCount ?? interfaceRange.default}
                  onChange={(e) => setInterfaceCount(Number(e.target.value))}
                  className="field-input"
                  data-testid="interface-count-input"
                />
              </label>
            </div>
          ) : null}
          {showCloudBridgeSettings ? (
            <div className="field">
              <label>
                <span className="field-label">Cloud Role</span>
                <select
                  value={cloudRole}
                  onChange={(e) => {
                    const nextRole = e.target.value as CloudRole;
                    setCloudRole(nextRole);
                    if (nextRole === "management") {
                      setBridgeGroup(
                        (current) => current.trim() || "management",
                      );
                      return;
                    }

                    setBridgeGroup((current) =>
                      current === "management" ? "" : current,
                    );
                  }}
                  className="field-input"
                  aria-label="Cloud Role"
                >
                  <option value="management">Management</option>
                  <option value="private-circuit">Private Circuit</option>
                  <option value="isp-carrier">ISP Carrier</option>
                </select>
              </label>
            </div>
          ) : null}
          {showCloudBridgeSettings ? (
            <div className="field">
              <label>
                <span className="field-label">Bridge Group</span>
                <input
                  type="text"
                  value={bridgeGroup}
                  onChange={(e) => setBridgeGroup(e.target.value)}
                  className="field-input"
                  aria-label="Bridge Group"
                />
              </label>
              <p className="panel-description">
                {cloudRole === "management"
                  ? "Management clouds default to the shared `management` bridge group."
                  : "Use the same bridge group on other clouds when they should share the same managed bridge."}
              </p>
              {showMacOsManagementSubnetGuidance ? (
                <p className="panel-description">
                  macOS management subnet: 172.31.255.0/24 (host 172.31.255.1).
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                submitting ||
                !name.trim() ||
                (showCloudBridgeSettings &&
                  cloudRole !== "management" &&
                  !bridgeGroup.trim())
              }
              data-testid="add-node-submit"
            >
              {submitting ? "Adding..." : "Add Node"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { computeNextPosition };
