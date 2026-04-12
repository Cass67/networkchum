import type { RunningConfigBackupRecord } from "../api/client.js";

type LabNode = {
  id: string;
  name: string;
  position?: { x: number; y: number };
};

type LabDetailsProps = {
  labName: string | null;
  nodes: LabNode[];
  nodeStatuses?: Record<string, string>;
  nodeMessages?: Record<string, string | null>;
  onPowerOnNode?: (nodeId: string) => void;
  nodeConnectCommands?: Record<string, string[]>;
  onConnectNode?: (nodeId: string) => void;
  onCopyNativeCommand?: (nodeId: string) => void;
  onDisconnectNativeConsole?: (nodeId: string) => void;
  nativeConsoleModeLabel?: string;
  selectedNodeId?: string | null;
  nodeRunningConfigBackups?: RunningConfigBackupRecord[];
};

const runningConfigStatusClass: Record<
  RunningConfigBackupRecord["status"],
  string
> = {
  captured: "status-pill--running",
  failed: "status-pill--failed",
  unsupported: "status-pill--stopped",
};

function formatBackupTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

export function LabDetails({
  labName,
  nodes,
  nodeStatuses = {},
  nodeMessages = {},
  onPowerOnNode,
  nodeConnectCommands = {},
  onConnectNode,
  onCopyNativeCommand,
  onDisconnectNativeConsole,
  nativeConsoleModeLabel,
  selectedNodeId = null,
  nodeRunningConfigBackups = [],
}: LabDetailsProps) {
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const backupRecords = nodeRunningConfigBackups ?? [];

  return (
    <section className="panel-section">
      <div className="panel-section-header">
        <p className="panel-eyebrow">Runtime</p>
        <h2>Lab Details</h2>
        <p className="panel-description">{labName ?? "No lab selected"}</p>
      </div>
      {nodes.length === 0 ? (
        <div className="panel-empty panel-empty--compact">
          <h3>No nodes in this lab</h3>
          <p>Add a device to populate the topology and runtime list.</p>
        </div>
      ) : null}
      <ul className="device-list">
        {nodes.map((node) => (
          <li
            key={node.id}
            className={`device-card${selectedNodeId === node.id ? " is-selected" : ""}`}
          >
            <div className="device-card-main">
              <div className="device-card-heading">
                <span
                  className={`status-dot ${(nodeStatuses[node.id] ?? "stopped") === "running" ? "running" : (nodeStatuses[node.id] ?? "stopped") === "failed" ? "failed" : "stopped"}`}
                />
                <span className="device-card-title">{node.name}</span>
                <span
                  className={`status-pill status-pill--${nodeStatuses[node.id] ?? "stopped"}`}
                >
                  {nodeStatuses[node.id] ?? "stopped"}
                </span>
              </div>
              {nodeMessages[node.id] ? (
                <p
                  className={`device-card-message${nodeStatuses[node.id] === "failed" ? " is-error" : ""}`}
                >
                  {nodeMessages[node.id]}
                </p>
              ) : null}
              {nodeConnectCommands[node.id]?.[0] === "telnet" &&
              nodeConnectCommands[node.id]?.[2] ? (
                <p className="device-card-message">
                  Console Port: {nodeConnectCommands[node.id]?.[2]}
                </p>
              ) : null}
              {nodeConnectCommands[node.id]?.[0] === "telnet" &&
              nodeConnectCommands[node.id]?.[2] ? (
                <p className="device-card-message">
                  Console Status:{" "}
                  {nodeMessages[node.id] ===
                  "Serial console already in use by another client."
                    ? "Busy"
                    : "Free"}
                </p>
              ) : null}
              {nodeConnectCommands[node.id]?.[0] === "telnet" &&
              nativeConsoleModeLabel ? (
                <p className="device-card-message">
                  Double-click Action: {nativeConsoleModeLabel}
                </p>
              ) : null}
            </div>
            <div className="device-card-actions">
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`Power On ${node.name}`}
                onClick={() => onPowerOnNode?.(node.id)}
                disabled={nodeStatuses[node.id] === "running"}
              >
                Power On
              </button>
              {nodeConnectCommands[node.id]?.length ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-label={
                    nodeConnectCommands[node.id]?.[0] === "telnet"
                      ? "Open Console"
                      : `Connect ${node.name}`
                  }
                  onClick={() => onConnectNode?.(node.id)}
                  disabled={
                    nodeConnectCommands[node.id]?.[0] === "telnet" &&
                    nodeMessages[node.id] ===
                      "Serial console already in use by another client."
                  }
                >
                  {nodeConnectCommands[node.id]?.[0] === "telnet"
                    ? "Open Console"
                    : "Connect"}
                </button>
              ) : null}
              {nodeConnectCommands[node.id]?.[0] === "telnet" &&
              nodeConnectCommands[node.id]?.[2] ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-label="Copy Native Command"
                  onClick={() => onCopyNativeCommand?.(node.id)}
                >
                  Copy Native Command
                </button>
              ) : null}
              {nodeMessages[node.id] ===
              "Serial console already in use by another client." ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-label="Disconnect Native Console"
                  onClick={() => onDisconnectNativeConsole?.(node.id)}
                >
                  Disconnect Native Console
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {selectedNode ? (
        <div className="detail-card" data-testid="selected-node-details">
          <p className="inspector-label">Focused Node</p>
          <h3>{selectedNode.name}</h3>
          <div className="detail-grid">
            <div className="detail-row">
              <span className="detail-label">ID</span>
              <span className="detail-value">{selectedNode.id}</span>
            </div>
            {selectedNode.position ? (
              <div className="detail-row">
                <span className="detail-label">Position</span>
                <span className="detail-value">
                  ({selectedNode.position.x}, {selectedNode.position.y})
                </span>
              </div>
            ) : null}
          </div>
          <div className="detail-row">
            <span className="detail-label">Running-config backups</span>
            <span className="detail-value detail-value--stacked">
              {backupRecords.length ? (
                <ul className="backup-records">
                  {backupRecords.map((backup) => (
                    <li key={backup.id} className="backup-record">
                      <span className="backup-record-row">
                        <span className="backup-record-timestamp">
                          {formatBackupTimestamp(backup.createdAt)}
                        </span>
                        <span
                          className={`status-pill ${
                            runningConfigStatusClass[backup.status]
                          }`}
                        >
                          {backup.status}
                        </span>
                      </span>
                      <span className="backup-record-source">
                        {backup.source}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="panel-description">
                  No running-config backups captured yet.
                </span>
              )}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
