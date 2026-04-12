import { useState } from "react";

type TargetButtonProps = {
  iface: {
    id: string;
    name: string;
    nodeId: string;
    nodeName: string;
    networkId: string | null;
  };
  onSelect: (iface: {
    id: string;
    name: string;
    nodeId: string;
    nodeName: string;
    networkId: string | null;
  }) => void;
};

function TargetButton({ iface, onSelect }: TargetButtonProps) {
  const [connecting, setConnecting] = useState(false);
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          setConnecting(true);
          onSelect(iface);
        }}
        disabled={connecting}
        data-testid={`target-${iface.id}`}
      >
        {iface.nodeName} - {iface.name}
      </button>
    </li>
  );
}

type CableInterface = {
  id: string;
  name: string;
  nodeId: string;
  nodeName: string;
  networkId: string | null;
};

type CableToolState =
  | "idle"
  | "selecting-source"
  | "selecting-target"
  | "connecting";

type CableToolProps = {
  interfaces: CableInterface[];
  labId: string | null;
  onCreateNetwork: (
    labId: string,
    input: { name: string; visible?: boolean },
  ) => Promise<{ network: { id: string } }>;
  onAttachInterfaces: (
    labId: string,
    input: { networkId: string; interfaceIds: string[] },
  ) => Promise<unknown>;
  onRefresh: () => void;
};

export function CableTool({
  interfaces,
  labId,
  onCreateNetwork,
  onAttachInterfaces,
  onRefresh,
}: CableToolProps) {
  const [state, setState] = useState<CableToolState>("idle");
  const [sourceInterface, setSourceInterface] = useState<CableInterface | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const availableInterfaces = interfaces.filter(
    (iface) => iface.networkId === null,
  );

  function handleStartConnect() {
    setState("selecting-source");
    setSourceInterface(null);
    setError(null);
  }

  function handleCancel() {
    setState("idle");
    setSourceInterface(null);
    setError(null);
  }

  function handleSelectSource(iface: CableInterface) {
    setSourceInterface(iface);
    setState("selecting-target");
  }

  async function handleSelectTarget(targetIface: CableInterface) {
    if (!labId || !sourceInterface) return;

    setState("connecting");
    setError(null);

    try {
      const networkName = `link-${sourceInterface.nodeName}-${targetIface.nodeName}`;
      const result = await onCreateNetwork(labId, {
        name: networkName,
        visible: true,
      });
      await onAttachInterfaces(labId, {
        networkId: result.network.id,
        interfaceIds: [sourceInterface.id, targetIface.id],
      });
      onRefresh();
      setState("idle");
      setSourceInterface(null);
    } catch {
      setError("Failed to create connection");
      setState("selecting-target");
    }
  }

  if (state === "idle") {
    return (
      <div data-testid="cable-tool">
        <button
          type="button"
          onClick={handleStartConnect}
          data-testid="cable-tool-connect-btn"
        >
          Cable Tool
        </button>
      </div>
    );
  }

  const sourceInterfaces = availableInterfaces.filter(
    (iface) => !sourceInterface || iface.nodeId !== sourceInterface.nodeId,
  );

  return (
    <div
      style={{
        border: "2px solid #0066cc",
        borderRadius: "8px",
        padding: "12px",
        background: "#f0f6ff",
      }}
      data-testid="cable-tool"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <strong>Cable Tool</strong>
        <button
          type="button"
          onClick={handleCancel}
          data-testid="cable-tool-cancel"
        >
          Cancel
        </button>
      </div>

      {state === "selecting-source" && (
        <div>
          <p>Select source interface:</p>
          {availableInterfaces.length === 0 ? (
            <p>No available interfaces</p>
          ) : (
            <ul>
              {availableInterfaces.map((iface) => (
                <li key={iface.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectSource(iface)}
                    data-testid={`source-${iface.id}`}
                  >
                    {iface.nodeName} - {iface.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {state === "selecting-target" && sourceInterface && (
        <div>
          <p>
            Source:{" "}
            <strong>
              {sourceInterface.nodeName} - {sourceInterface.name}
            </strong>
          </p>
          <p>Select target interface:</p>
          {sourceInterfaces.length === 0 ? (
            <p>No available target interfaces on other nodes</p>
          ) : (
            <ul>
              {sourceInterfaces.map((iface) => (
                <TargetButton
                  key={iface.id}
                  iface={iface}
                  onSelect={handleSelectTarget}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {state === "connecting" && <p>Connecting...</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}
