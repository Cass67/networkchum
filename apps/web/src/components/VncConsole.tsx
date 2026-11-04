import RFB from "@novnc/novnc";
import { useEffect, useRef, useState } from "react";

import { getStoredApiToken } from "../api/client.js";
import { resolveVncWebSocketUrl } from "../runtimeUrls.js";

type VncConsoleProps = {
  labId: string;
  nodeId: string;
  nodeName: string;
  onClose: () => void;
};

/**
 * Graphical console for templates that boot with VNC (FTD, ISE, PAN-OS).
 * RFB runs over the API's WebSocket proxy, so nothing but 4000 needs to be
 * reachable from the browser.
 */
export function VncConsole({
  labId,
  nodeId,
  nodeName,
  onClose,
}: VncConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Connecting…");

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const token = getStoredApiToken();
    const rfb = new RFB(
      containerRef.current,
      resolveVncWebSocketUrl(window.location, labId, nodeId),
      { wsProtocols: token ? ["networkchum", token] : [] },
    );
    rfb.scaleViewport = true;
    rfb.resizeSession = true;

    const onConnect = () => setStatus("Connected");
    const onDisconnect = (event: CustomEvent<{ clean?: boolean }>) =>
      setStatus(event.detail?.clean ? "Disconnected" : "Connection lost");
    rfb.addEventListener("connect", onConnect);
    rfb.addEventListener("disconnect", onDisconnect);

    return () => {
      rfb.removeEventListener("connect", onConnect);
      rfb.removeEventListener("disconnect", onDisconnect);
      rfb.disconnect();
    };
  }, [labId, nodeId]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#1e1e1e",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          background: "#2d2d2d",
          color: "#ccc",
          fontSize: 13,
        }}
      >
        <span>
          VNC — {nodeName} <span style={{ opacity: 0.6 }}>({status})</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "1px solid #555",
            color: "#ccc",
            cursor: "pointer",
            padding: "2px 10px",
            borderRadius: 3,
          }}
        >
          Close
        </button>
      </div>
      <div ref={containerRef} style={{ flex: 1, overflow: "hidden" }} />
    </div>
  );
}
