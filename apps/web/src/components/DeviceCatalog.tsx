type CatalogEntry = {
  id: string;
  name: string;
  source: string;
  vendor?: string;
  runtime?: string;
  configSchema?: {
    ramMb: { default: number; min: number; max: number };
    vcpu: { default: number; min: number; max: number };
    interfaceCount: { default: number; min: number; max: number };
  };
};

type DeviceCatalogProps = {
  entries: CatalogEntry[];
  onSelectTemplate?: (templateId: string) => void;
  onEditTemplate?: (templateId: string) => void;
};

export function DeviceCatalog({
  entries,
  onSelectTemplate,
  onEditTemplate,
}: DeviceCatalogProps) {
  if (entries.length === 0) {
    return (
      <div className="panel-empty">
        <h3>No templates available</h3>
        <p>
          Bind images or add built-in templates to start populating the catalog.
        </p>
      </div>
    );
  }

  return (
    <ul className="entity-list entity-list--dense" aria-label="Device catalog">
      {entries.map((entry) => (
        <li key={entry.id} className="entity-list-item">
          <div className="resource-card">
            <div className="resource-card-copy">
              <span className="resource-card-label">{entry.source}</span>
              <strong className="resource-card-title">{entry.name}</strong>
              {entry.vendor || entry.runtime ? (
                <p className="resource-card-meta">
                  {[
                    entry.vendor,
                    entry.runtime === "qemu"
                      ? "VM"
                      : entry.runtime === "container"
                        ? "Container"
                        : undefined,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </p>
              ) : null}
              {entry.configSchema ? (
                <p className="resource-card-meta">
                  {entry.configSchema.vcpu.default} vCPU •{" "}
                  {entry.configSchema.ramMb.default} MB RAM •{" "}
                  {entry.configSchema.interfaceCount.default} interfaces
                </p>
              ) : null}
            </div>
            <div className="resource-card-controls">
              {onEditTemplate ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onEditTemplate(entry.id)}
                  aria-label={`Edit ${entry.name}`}
                >
                  Edit
                </button>
              ) : null}
              {onSelectTemplate ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onSelectTemplate(entry.id)}
                  data-testid={`add-from-catalog-${entry.id}`}
                >
                  Add
                </button>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
