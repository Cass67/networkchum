import { useState } from "react";

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
  onSubmit: (input: {
    templateId: string;
    name: string;
    position: { x: number; y: number };
    interfaceCount?: number;
    bridgeInterface?: string | null;
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
  hostInterfaces,
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
  const showBridgeInterface = selectedTemplate?.runtime === "cloud";
  const [bridgeInterface, setBridgeInterface] = useState<string>("");

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
        bridgeInterface: showBridgeInterface ? bridgeInterface || null : null,
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
      setBridgeInterface("");
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
          {showBridgeInterface ? (
            <div className="field">
              <label>
                <span className="field-label">Physical Interface</span>
                <select
                  value={bridgeInterface}
                  onChange={(e) => setBridgeInterface(e.target.value)}
                  className="field-input"
                  aria-label="Physical Interface"
                  data-testid="bridge-interface-select"
                >
                  <option value="">No Physical Interface</option>
                  {hostInterfaces.map((iface) => (
                    <option key={iface} value={iface}>
                      {iface}
                    </option>
                  ))}
                </select>
              </label>
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
              disabled={submitting || !name.trim()}
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
