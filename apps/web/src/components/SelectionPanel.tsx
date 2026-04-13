import { useEffect, useState } from "react";

type SelectionPanelProps = {
  selected:
    | { type: "lab"; lab: { id: string; name: string; autoBackup?: boolean } }
    | {
        type: "node";
        node: {
          id: string;
          name: string;
          interfaces?: Array<{ id: string; name: string }>;
        };
        status: string;
        connectCommand?: string[];
        attachments?: Array<{ interfaceId: string; networkName: string }>;
        networks?: Array<{ id: string; name: string }>;
      }
    | { type: "cable"; cable: { id: string; name: string } }
    | {
        type: "image";
        image: {
          id: string;
          name: string;
          templateId: string | null;
          catalogState: string;
        };
      }
    | null;
  onRenameLab?: (labId: string, name: string) => void | Promise<void>;
  onSetLabAutoBackup?: (
    labId: string,
    autoBackup: boolean,
  ) => void | Promise<void>;
  onDeleteLab?: (labId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDeleteCable?: (networkId: string) => void;
  onPowerOnNode?: (nodeId: string) => void;
  onPowerOffNode?: (nodeId: string) => void;
  onEditStartupConfig?: (nodeId: string) => void;
  onAttachInterface?: (
    interfaceId: string,
    networkId: string,
  ) => void | Promise<void>;
  onDetachInterface?: (interfaceId: string) => void | Promise<void>;
  onUnbindImage?: (imageId: string) => void;
  onRemoveImageFromCatalog?: (imageId: string) => void;
  onDeleteImageFile?: (imageId: string) => void | Promise<void>;
};

export function SelectionPanel(props: SelectionPanelProps) {
  const { selected } = props;
  const [labName, setLabName] = useState("");
  const [savingLabName, setSavingLabName] = useState(false);
  const [interfaceTargets, setInterfaceTargets] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    if (selected?.type === "lab") {
      setLabName(selected.lab.name);
    } else {
      setLabName("");
    }

    if (selected?.type === "node") {
      const nextTargets = Object.fromEntries(
        (selected.node.interfaces ?? []).map((iface) => [
          iface.id,
          selected.networks?.[0]?.id ?? "",
        ]),
      );
      setInterfaceTargets(nextTargets);
    } else {
      setInterfaceTargets({});
    }

    setSavingLabName(false);
  }, [selected]);

  async function handleRenameLab() {
    if (selected?.type !== "lab") {
      return;
    }

    const nextName = labName.trim();
    if (!nextName || nextName === selected.lab.name) {
      return;
    }

    setSavingLabName(true);
    try {
      await props.onRenameLab?.(selected.lab.id, nextName);
    } finally {
      setSavingLabName(false);
    }
  }

  return (
    <section className="panel-section">
      <div className="panel-section-header">
        <p className="panel-eyebrow">Inspector</p>
        <h2>Selection</h2>
        <p className="panel-description">
          Context-aware controls for the active lab object.
        </p>
      </div>
      {!selected ? (
        <div className="panel-empty">
          <h3>Nothing selected</h3>
          <p>Pick a lab, node, cable, or image to unlock focused actions.</p>
        </div>
      ) : null}
      {selected?.type === "lab" ? (
        <div className="inspector-card">
          <div className="inspector-header">
            <span className="inspector-label">Lab</span>
            <h3>{selected.lab.name}</h3>
          </div>
          <label className="field">
            <span className="field-label">Lab name</span>
            <input
              type="text"
              className="field-input"
              value={labName}
              onChange={(event) => setLabName(event.target.value)}
            />
          </label>
          <div className="action-grid">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleRenameLab()}
              disabled={
                savingLabName ||
                !labName.trim() ||
                labName.trim() === selected.lab.name
              }
            >
              Save Name
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => props.onDeleteLab?.(selected.lab.id)}
            >
              Delete Lab
            </button>
          </div>
          <label className="field-checkbox" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              aria-label="Auto Backup"
              checked={Boolean(selected.lab.autoBackup)}
              onChange={(event) =>
                void props.onSetLabAutoBackup?.(
                  selected.lab.id,
                  event.target.checked,
                )
              }
            />
            <span>Auto Backup</span>
          </label>
        </div>
      ) : null}
      {selected?.type === "node" ? (
        <div className="inspector-card">
          <div className="inspector-header">
            <span className="inspector-label">Node</span>
            <h3>{selected.node.name}</h3>
            <span className={`status-pill status-pill--${selected.status}`}>
              {selected.status}
            </span>
          </div>
          {selected.connectCommand?.[0] === "telnet" &&
          selected.connectCommand[2] ? (
            <p className="panel-description">
              Telnet Port: {selected.connectCommand[2]}
            </p>
          ) : null}
          {selected.node.interfaces?.length ? (
            <div className="field" style={{ marginTop: 12 }}>
              <span className="field-label">Interfaces</span>
              <ul className="entity-list entity-list--dense">
                {selected.node.interfaces.map((iface) => {
                  const attachment = selected.attachments?.find(
                    (entry) => entry.interfaceId === iface.id,
                  );

                  return (
                    <li key={iface.id} className="entity-list-item">
                      <div className="resource-card">
                        <div className="resource-card-copy">
                          <strong className="resource-card-title">
                            {iface.name}
                          </strong>
                          <p className="resource-card-meta">
                            {attachment
                              ? `Connected to ${attachment.networkName}`
                              : "Not connected"}
                          </p>
                        </div>
                        <div className="resource-card-controls">
                          {attachment ? (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() =>
                                props.onDetachInterface?.(iface.id)
                              }
                              aria-label={`Disconnect ${iface.name}`}
                            >
                              Disconnect
                            </button>
                          ) : selected.networks?.length ? (
                            <>
                              <select
                                className="field-input"
                                value={interfaceTargets[iface.id] ?? ""}
                                onChange={(event) =>
                                  setInterfaceTargets((current) => ({
                                    ...current,
                                    [iface.id]: event.target.value,
                                  }))
                                }
                                aria-label={`Network for ${iface.name}`}
                              >
                                {selected.networks.map((network) => (
                                  <option key={network.id} value={network.id}>
                                    {network.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() =>
                                  props.onAttachInterface?.(
                                    iface.id,
                                    interfaceTargets[iface.id] ?? "",
                                  )
                                }
                                aria-label={`Connect ${iface.name}`}
                                disabled={!interfaceTargets[iface.id]}
                              >
                                Connect
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          <div className="action-grid">
            {selected.status === "running" ? (
              <button
                type="button"
                className="btn btn-warning"
                onClick={() => props.onPowerOffNode?.(selected.node.id)}
              >
                Power Off
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-success"
                onClick={() => props.onPowerOnNode?.(selected.node.id)}
              >
                Power On
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => props.onEditStartupConfig?.(selected.node.id)}
            >
              Startup Config
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => props.onDeleteNode?.(selected.node.id)}
            >
              Delete Node
            </button>
          </div>
        </div>
      ) : null}
      {selected?.type === "cable" ? (
        <div className="inspector-card">
          <div className="inspector-header">
            <span className="inspector-label">Cable</span>
            <h3>{selected.cable.name}</h3>
          </div>
          <div className="action-grid">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => props.onDeleteCable?.(selected.cable.id)}
            >
              Delete Cable
            </button>
          </div>
        </div>
      ) : null}
      {selected?.type === "image" ? (
        <div className="inspector-card">
          <div className="inspector-header">
            <span className="inspector-label">Image</span>
            <h3>{selected.image.name}</h3>
            <span
              className={`status-pill${selected.image.catalogState === "removed" ? " status-pill--stopped" : " status-pill--running"}`}
            >
              {selected.image.catalogState}
            </span>
          </div>
          <div className="action-grid">
            {selected.image.templateId ? (
              <button
                type="button"
                className="btn"
                onClick={() => props.onUnbindImage?.(selected.image.id)}
              >
                Unbind Image
              </button>
            ) : null}
            {selected.image.catalogState !== "removed" ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() =>
                  props.onRemoveImageFromCatalog?.(selected.image.id)
                }
              >
                Remove From Catalog
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => props.onDeleteImageFile?.(selected.image.id)}
            >
              Delete File
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
