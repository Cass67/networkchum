import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";

import { resolveConsoleWebSocketUrl } from "../runtimeUrls.js";

type NodeConsoleProps = {
  labId: string;
  nodeId: string;
  nodeName: string;
  onClose: () => void;
};

export function NodeConsole({
  labId,
  nodeId,
  nodeName,
  onClose,
}: NodeConsoleProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "monospace",
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    if (containerRef.current) {
      term.open(containerRef.current);
      fitAddon.fit();
    }

    const wsUrl = resolveConsoleWebSocketUrl(window.location, labId, nodeId);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      term.write("\x1b[32m[Connected to serial console]\x1b[0m\r\n");
    };

    ws.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
      if (event.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(event.data));
      } else {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      term.write("\r\n\x1b[31m[Connection closed]\x1b[0m\r\n");
    };

    ws.onerror = () => {
      term.write(
        "\r\n\x1b[31m[WebSocket error — is the API running?]\x1b[0m\r\n",
      );
    };

    const dataDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      ws.close();
      term.dispose();
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
        <span>Console — {nodeName}</span>
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
