type Lab = {
  id: string;
  name: string;
};

type LabBrowserProps = {
  labs: Lab[];
  selectedLabId?: string | null;
  onSelectLab?: (labId: string) => void;
  onContextMenuLab?: (
    labId: string,
    position: { x: number; y: number },
  ) => void;
};

export function LabBrowser({
  labs,
  selectedLabId = null,
  onSelectLab,
  onContextMenuLab,
}: LabBrowserProps) {
  if (labs.length === 0) {
    return (
      <div className="panel-empty">
        <h3>No labs yet</h3>
        <p>Create a lab to start laying out devices and links.</p>
      </div>
    );
  }

  return (
    <ul className="entity-list" aria-label="Saved labs">
      {labs.map((lab) => (
        <li key={lab.id} className="entity-list-item">
          <button
            type="button"
            className={`list-card${selectedLabId === lab.id ? " is-selected" : ""}`}
            aria-label={`Open ${lab.name}`}
            aria-current={selectedLabId === lab.id ? "page" : undefined}
            onClick={() => onSelectLab?.(lab.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onContextMenuLab?.(lab.id, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <span className="list-card-row">
              <span className="list-card-title">{lab.name}</span>
              <span
                className={`list-item-badge${selectedLabId === lab.id ? " is-accent" : ""}`}
              >
                {selectedLabId === lab.id ? "Active" : "Saved"}
              </span>
            </span>
            <span className="list-card-meta">
              {selectedLabId === lab.id
                ? "Current workspace"
                : "Open lab topology"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
