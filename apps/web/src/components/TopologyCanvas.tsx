import { useCallback, useRef, useState } from "react";

import { ContextMenu } from "./ContextMenu.js";

type CanvasNode = {
  id: string;
  name: string;
  position?: { x: number; y: number };
  interfaces?: Array<{ id: string; name: string; slot: number }>;
  state?: { desiredPower: string };
};

type CanvasNetwork = {
  id: string;
  kind: string;
  name: string;
  visible: boolean;
};

type CanvasAttachment = {
  interfaceId: string;
  networkId: string;
};

type TopologyCanvasProps = {
  labName: string | null;
  labId: string | null;
  nodes: CanvasNode[];
  networks?: CanvasNetwork[];
  attachments?: CanvasAttachment[];
  nodeStatuses?: Record<string, string>;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  onMoveNode?: (nodeId: string, position: { x: number; y: number }) => void;
  onCreateNetwork?: (
    labId: string,
    input: { name: string; visible?: boolean },
  ) => Promise<{ network: { id: string } }>;
  onAttachInterfaces?: (
    labId: string,
    input: { networkId: string; interfaceIds: string[] },
  ) => Promise<unknown>;
  onDetachInterface?: (labId: string, interfaceId: string) => Promise<unknown>;
  onRefreshLab?: () => void;
  selectedCableId?: string | null;
  onSelectCable?: (networkId: string | null) => void;
  onDeleteCable?: (networkId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onPowerOnNode?: (nodeId: string) => void;
  onPowerOffNode?: (nodeId: string) => void;
  onOpenNativeConsole?: (nodeId: string) => void;
};

const NODE_WIDTH = 100;
const NODE_HEIGHT = 48;
function getNodeCenter(node: CanvasNode): { x: number; y: number } {
  return {
    x: (node.position?.x ?? 32) + NODE_WIDTH / 2,
    y: (node.position?.y ?? 32) + NODE_HEIGHT / 2,
  };
}

function getCableLabelPosition(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  side: "source" | "target",
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const horizontalBias = Math.abs(dx) >= Math.abs(dy);

  if (side === "source") {
    return horizontalBias
      ? {
          x: x1 + (dx >= 0 ? NODE_WIDTH / 2 + 18 : -(NODE_WIDTH / 2 + 18)),
          y: y1 - 8,
        }
      : {
          x: x1,
          y: y1 + (dy >= 0 ? NODE_HEIGHT / 2 + 18 : -(NODE_HEIGHT / 2 + 18)),
        };
  }

  return horizontalBias
    ? {
        x: x2 + (dx >= 0 ? -(NODE_WIDTH / 2 + 18) : NODE_WIDTH / 2 + 18),
        y: y2 - 8,
      }
    : {
        x: x2,
        y: y2 + (dy >= 0 ? -(NODE_HEIGHT / 2 + 18) : NODE_HEIGHT / 2 + 18),
      };
}

type LinkInfo = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  networkName: string;
  networkId: string;
  sourceLabel?: string;
  targetLabel?: string;
};

function buildLinks(
  nodes: CanvasNode[],
  networks: CanvasNetwork[],
  attachments: CanvasAttachment[],
): LinkInfo[] {
  const links: LinkInfo[] = [];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const network of networks) {
    const attachedIfaces = attachments
      .filter((a) => a.networkId === network.id)
      .map((a) => {
        const parentNode = nodes.find((n) =>
          n.interfaces?.some((iface) => iface.id === a.interfaceId),
        );
        const iface = parentNode?.interfaces?.find(
          (i) => i.id === a.interfaceId,
        );
        return { attachment: a, node: parentNode, iface };
      })
      .filter((entry) => entry.node && entry.iface);

    const uniqueNodeIds = [...new Set(attachedIfaces.map((e) => e.node!.id))];

    if (uniqueNodeIds.length < 2) continue;

    const midX =
      uniqueNodeIds.reduce((sum, id) => {
        const n = nodeMap.get(id)!;
        return sum + getNodeCenter(n).x;
      }, 0) / uniqueNodeIds.length;
    const midY =
      uniqueNodeIds.reduce((sum, id) => {
        const n = nodeMap.get(id)!;
        return sum + getNodeCenter(n).y;
      }, 0) / uniqueNodeIds.length;

    if (uniqueNodeIds.length === 2) {
      const n1 = nodeMap.get(uniqueNodeIds[0]!)!;
      const n2 = nodeMap.get(uniqueNodeIds[1]!)!;
      const c1 = getNodeCenter(n1);
      const c2 = getNodeCenter(n2);
      const source = attachedIfaces.find((entry) => entry.node?.id === n1.id);
      const target = attachedIfaces.find((entry) => entry.node?.id === n2.id);
      links.push({
        id: `link-${network.id}`,
        x1: c1.x,
        y1: c1.y,
        x2: c2.x,
        y2: c2.y,
        networkName: network.name,
        networkId: network.id,
        sourceLabel: source?.iface?.name,
        targetLabel: target?.iface?.name,
      });
    } else {
      for (const nodeId of uniqueNodeIds) {
        const n = nodeMap.get(nodeId)!;
        const c = getNodeCenter(n);
        const iface = attachedIfaces.find(
          (entry) => entry.node?.id === nodeId,
        )?.iface;
        links.push({
          id: `link-${network.id}-${nodeId}`,
          x1: c.x,
          y1: c.y,
          x2: midX,
          y2: midY,
          networkName: network.name,
          networkId: network.id,
          sourceLabel: iface?.name,
        });
      }
    }
  }

  return links;
}

type DragState = {
  dragging: boolean;
  nodeId: string | null;
  offsetX: number;
  offsetY: number;
  selectedIds: string[];
  startPositions: Record<string, { x: number; y: number }>;
};

type SelectionBoxState = {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type PanState = {
  active: boolean;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
};

type CableState = {
  mode: "idle" | "drawing";
  sourceNodeId: string | null;
  mousePos: { x: number; y: number } | null;
};

type CableDialogState = {
  sourceNodeId: string;
  targetNodeId: string;
  sourceInterfaceId: string;
  targetInterfaceId: string;
};

type DisconnectPopup = {
  type: "link";
  networkId: string;
  networkName: string;
  x: number;
  y: number;
};

function getSvgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { x: svgPt.x, y: svgPt.y };
}

export function TopologyCanvas({
  labName,
  labId,
  nodes,
  networks = [],
  attachments = [],
  nodeStatuses = {},
  selectedNodeId = null,
  onSelectNode,
  onMoveNode,
  onCreateNetwork,
  onAttachInterfaces,
  onDetachInterface,
  onRefreshLab,
  onSelectCable,
  onDeleteCable,
  onDeleteNode,
  onPowerOnNode,
  onPowerOffNode,
  onOpenNativeConsole,
}: TopologyCanvasProps) {
  const svgWidth = 1440;
  const svgHeight = 900;

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState>({
    dragging: false,
    nodeId: null,
    offsetX: 0,
    offsetY: 0,
    selectedIds: [],
    startPositions: {},
  });
  const [pendingPositions, setPendingPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(
    null,
  );
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(
    selectedNodeId ? [selectedNodeId] : [],
  );
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [cableState, setCableState] = useState<CableState>({
    mode: "idle",
    sourceNodeId: null,
    mousePos: null,
  });
  const [cableDialog, setCableDialog] = useState<CableDialogState | null>(null);
  const [disconnectPopup, setDisconnectPopup] =
    useState<DisconnectPopup | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: Array<{ label: string; onSelect: () => void }>;
  } | null>(null);

  const resolvedNodes = nodes.map((n) => {
    const pending = pendingPositions[n.id];
    if (pending) return { ...n, position: pending };
    return n;
  });

  const attachedInterfaceIds = new Set(attachments.map((a) => a.interfaceId));
  const interfaceNetworkMap = new Map(
    attachments.map((a) => [a.interfaceId, a.networkId]),
  );
  const networkMap = new Map(networks.map((n) => [n.id, n]));

  const links = buildLinks(resolvedNodes, networks, attachments);

  const clearCable = useCallback(() => {
    setCableState({ mode: "idle", sourceNodeId: null, mousePos: null });
  }, []);

  const syncSingleSelection = useCallback(
    (nodeId: string | null) => {
      setSelectedNodeIds(nodeId ? [nodeId] : []);
      onSelectNode?.(nodeId);
    },
    [onSelectNode],
  );

  const firstFreeInterfaceId = useCallback(
    (node: CanvasNode | undefined): string => {
      if (!node?.interfaces?.length) return "";
      return (
        node.interfaces.find((iface) => !attachedInterfaceIds.has(iface.id))
          ?.id ?? node.interfaces[0]!.id
      );
    },
    [attachedInterfaceIds],
  );

  const handleSvgMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const target = e.target as SVGElement;

      if (spaceHeld) {
        setPanState({
          active: true,
          startClientX: e.clientX,
          startClientY: e.clientY,
          originX: viewportOffset.x,
          originY: viewportOffset.y,
        });
        return;
      }

      const nodeGroup = target.closest<SVGGElement>("[data-node-id]");
      if (nodeGroup) {
        const nodeId = nodeGroup.getAttribute("data-node-id")!;
        const node = resolvedNodes.find((n) => n.id === nodeId);
        if (cableState.mode !== "drawing" && node && onMoveNode) {
          const svg = svgRef.current;
          if (!svg) return;
          const svgPt = getSvgPoint(svg, e.clientX, e.clientY);
          const nodeX = node.position?.x ?? 32;
          const nodeY = node.position?.y ?? 32;
          dragRef.current = {
            dragging: true,
            nodeId,
            offsetX: svgPt.x - nodeX,
            offsetY: svgPt.y - nodeY,
            selectedIds: selectedNodeIds.includes(nodeId)
              ? selectedNodeIds
              : [nodeId],
            startPositions: Object.fromEntries(
              (selectedNodeIds.includes(nodeId)
                ? selectedNodeIds
                : [nodeId]
              ).map((id) => {
                const selectedNode = resolvedNodes.find(
                  (entry) => entry.id === id,
                );
                return [
                  id,
                  {
                    x: selectedNode?.position?.x ?? 32,
                    y: selectedNode?.position?.y ?? 32,
                  },
                ];
              }),
            ),
          };
          e.preventDefault();
        }
        syncSingleSelection(nodeId);
        onSelectCable?.(null);
        return;
      }

      const linkEl = target.closest<SVGLineElement>("[data-link-id]");
      if (linkEl) {
        const networkId = linkEl.getAttribute("data-link-id")!;
        const linkInfo = links.find(
          (l) => l.networkId === networkId || l.id === networkId,
        );
        const svg = svgRef.current;
        if (!svg) return;
        const svgPt = getSvgPoint(svg, e.clientX, e.clientY);
        setDisconnectPopup({
          type: "link",
          networkId,
          networkName: linkInfo?.networkName ?? networkId,
          x: svgPt.x,
          y: svgPt.y,
        });
        onSelectCable?.(networkId);
        return;
      }

      if (cableState.mode === "idle") {
        const svg = svgRef.current;
        if (!svg) return;
        const svgPt = getSvgPoint(svg, e.clientX, e.clientY);
        setSelectionBox({
          active: true,
          startX: svgPt.x,
          startY: svgPt.y,
          currentX: svgPt.x,
          currentY: svgPt.y,
        });
      }

      setDisconnectPopup(null);
      syncSingleSelection(null);
      onSelectCable?.(null);
    },
    [
      cableState.mode,
      onMoveNode,
      onSelectCable,
      resolvedNodes,
      links,
      syncSingleSelection,
      selectedNodeIds,
      spaceHeld,
      viewportOffset,
    ],
  );

  const handleSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const svgPt = getSvgPoint(svg, e.clientX, e.clientY);

      if (panState?.active) {
        setViewportOffset({
          x: panState.originX + (e.clientX - panState.startClientX),
          y: panState.originY + (e.clientY - panState.startClientY),
        });
        return;
      }

      if (dragRef.current.dragging && dragRef.current.nodeId) {
        const newX = svgPt.x - dragRef.current.offsetX;
        const newY = svgPt.y - dragRef.current.offsetY;
        const origin = dragRef.current.startPositions[dragRef.current.nodeId!];
        const deltaX = newX - origin.x;
        const deltaY = newY - origin.y;
        setPendingPositions((prev) => {
          const next = { ...prev };
          for (const selectedId of dragRef.current.selectedIds) {
            const start = dragRef.current.startPositions[selectedId];
            next[selectedId] = { x: start.x + deltaX, y: start.y + deltaY };
          }
          return next;
        });
        return;
      }

      if (selectionBox?.active) {
        setSelectionBox((prev) =>
          prev ? { ...prev, currentX: svgPt.x, currentY: svgPt.y } : prev,
        );
        return;
      }

      if (cableState.mode === "drawing") {
        setCableState((prev) => ({
          ...prev,
          mousePos: { x: svgPt.x, y: svgPt.y },
        }));
      }
    },
    [cableState.mode, selectionBox?.active, panState],
  );

  const handleSvgMouseUp = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (panState?.active) {
        setPanState(null);
        return;
      }

      if (dragRef.current.dragging && dragRef.current.nodeId) {
        if (onMoveNode) {
          for (const nodeId of dragRef.current.selectedIds) {
            const pos = pendingPositions[nodeId];
            if (pos) {
              onMoveNode(nodeId, pos);
            }
          }
        }
        setPendingPositions((prev) => {
          const next = { ...prev };
          for (const nodeId of dragRef.current.selectedIds) {
            delete next[nodeId];
          }
          return next;
        });
        dragRef.current = {
          dragging: false,
          nodeId: null,
          offsetX: 0,
          offsetY: 0,
          selectedIds: [],
          startPositions: {},
        };
        return;
      }

      if (selectionBox?.active) {
        const minX = Math.min(selectionBox.startX, selectionBox.currentX);
        const maxX = Math.max(selectionBox.startX, selectionBox.currentX);
        const minY = Math.min(selectionBox.startY, selectionBox.currentY);
        const maxY = Math.max(selectionBox.startY, selectionBox.currentY);
        const nextSelected = resolvedNodes
          .filter((node) => {
            const center = getNodeCenter(node);
            return (
              center.x >= minX &&
              center.x <= maxX &&
              center.y >= minY &&
              center.y <= maxY
            );
          })
          .map((node) => node.id);

        setSelectedNodeIds(nextSelected);
        onSelectNode?.(nextSelected[0] ?? null);
        setSelectionBox(null);
        return;
      }

      if (cableState.mode === "drawing" && cableState.sourceNodeId) {
        const target = e.target as SVGElement;
        const nodeGroup = target.closest<SVGGElement>("[data-node-id]");
        const targetNodeId = nodeGroup?.getAttribute("data-node-id");
        if (targetNodeId && targetNodeId !== cableState.sourceNodeId) {
          const sourceNode = resolvedNodes.find(
            (node) => node.id === cableState.sourceNodeId,
          );
          const targetNode = resolvedNodes.find(
            (node) => node.id === targetNodeId,
          );
          setCableDialog({
            sourceNodeId: cableState.sourceNodeId,
            targetNodeId,
            sourceInterfaceId: firstFreeInterfaceId(sourceNode),
            targetInterfaceId: firstFreeInterfaceId(targetNode),
          });
        }
        clearCable();
      }
    },
    [
      pendingPositions,
      onMoveNode,
      cableState.mode,
      cableState.sourceNodeId,
      clearCable,
      resolvedNodes,
      firstFreeInterfaceId,
      selectionBox,
      onSelectNode,
      panState,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<SVGSVGElement>) => {
      if (e.key === "Escape") {
        if (cableState.mode === "drawing") {
          clearCable();
          return;
        }
        setDisconnectPopup(null);
        syncSingleSelection(null);
      }
      if (e.key === " ") {
        setSpaceHeld(true);
      }
    },
    [cableState.mode, clearCable, syncSingleSelection],
  );

  const handleKeyUp = useCallback((e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === " ") {
      setSpaceHeld(false);
      setPanState(null);
    }
  }, []);

  const handleDisconnect = useCallback(
    async (interfaceIds: string[]) => {
      if (!labId || !onDetachInterface) return;
      setDisconnectPopup(null);
      for (const ifaceId of interfaceIds) {
        await onDetachInterface(labId, ifaceId);
      }
      onRefreshLab?.();
    },
    [labId, onDetachInterface, onRefreshLab],
  );

  const handleSvgContextMenu = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      e.preventDefault();
      const target = e.target as SVGElement;

      const linkEl = target.closest<SVGLineElement>("[data-link-id]");
      if (linkEl) {
        const networkId = linkEl.getAttribute("data-link-id")!;
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            {
              label: "Disconnect",
              onSelect: () => {
                if (onDeleteCable) {
                  onDeleteCable(networkId);
                  return;
                }
                const relatedAttachments = attachments.filter(
                  (attachment) => attachment.networkId === networkId,
                );
                void handleDisconnect(
                  relatedAttachments.map(
                    (attachment) => attachment.interfaceId,
                  ),
                );
              },
            },
          ],
        });
        onSelectCable?.(networkId);
        return;
      }

      const nodeGroup = target.closest<SVGGElement>("[data-node-id]");
      if (nodeGroup) {
        const nodeId = nodeGroup.getAttribute("data-node-id")!;
        const node = resolvedNodes.find((entry) => entry.id === nodeId);
        const status =
          nodeStatuses[nodeId] ??
          (node?.state?.desiredPower === "on" ? "running" : "stopped");
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            {
              label: "Add Cable",
              onSelect: () => {
                const svg = svgRef.current;
                if (!svg) return;
                const svgPt = getSvgPoint(svg, e.clientX, e.clientY);
                setCableState({
                  mode: "drawing",
                  sourceNodeId: nodeId,
                  mousePos: svgPt,
                });
              },
            },
            status === "running"
              ? { label: "Power Off", onSelect: () => onPowerOffNode?.(nodeId) }
              : { label: "Power On", onSelect: () => onPowerOnNode?.(nodeId) },
            { label: "Delete Node", onSelect: () => onDeleteNode?.(nodeId) },
          ],
        });
        onSelectNode?.(nodeId);
        return;
      }

      setContextMenu(null);
    },
    [
      attachments,
      handleDisconnect,
      nodeStatuses,
      onDeleteCable,
      onDeleteNode,
      onPowerOffNode,
      onPowerOnNode,
      onSelectCable,
      onSelectNode,
      resolvedNodes,
    ],
  );

  const sourcePortCenter = (() => {
    if (cableState.mode !== "drawing" || !cableState.sourceNodeId) return null;
    const sourceNode = nodes.find((n) => n.id === cableState.sourceNodeId);
    if (!sourceNode) return null;
    return getNodeCenter(
      resolvedNodes.find((n) => n.id === sourceNode.id) ?? sourceNode,
    );
  })();

  const isDragging = Object.keys(pendingPositions).length > 0;

  return (
    <section className="canvas-panel">
      <div className="canvas-panel-header">
        <div>
          <p className="panel-eyebrow">Workspace</p>
          <h2>Canvas</h2>
        </div>
        <p className="canvas-panel-copy">
          {labName
            ? `${labName} topology`
            : "Create a lab and start dropping devices onto the board."}
        </p>
      </div>
      <div className="canvas-surface">
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="xMinYMin meet"
          className="canvas-svg"
          style={{
            cursor: panState?.active
              ? "grabbing"
              : spaceHeld
                ? "grab"
                : isDragging
                  ? "grabbing"
                  : cableState.mode === "drawing"
                    ? "crosshair"
                    : "default",
          }}
          data-testid="topology-svg"
          role="application"
          aria-label={labName ? `${labName} topology` : "Topology canvas"}
          onMouseDown={handleSvgMouseDown}
          onDoubleClick={(event) => {
            const target = event.target as SVGElement;
            const nodeGroup = target.closest<SVGGElement>("[data-node-id]");
            const nodeId = nodeGroup?.getAttribute("data-node-id");
            if (nodeId) {
              onOpenNativeConsole?.(nodeId);
            }
          }}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onContextMenu={handleSvgContextMenu}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          focusable
        >
          <g
            data-testid="viewport-layer"
            transform={`translate(${viewportOffset.x} ${viewportOffset.y})`}
          >
            {links.map((link) => (
              <line
                key={link.id}
                x1={link.x1}
                y1={link.y1}
                x2={link.x2}
                y2={link.y2}
                stroke="var(--canvas-link)"
                strokeWidth={4}
                data-testid={link.id}
                data-link-id={link.networkId}
                style={{ cursor: "pointer" }}
              />
            ))}

            {cableState.mode === "drawing" &&
              sourcePortCenter &&
              cableState.mousePos && (
                <line
                  x1={sourcePortCenter.x}
                  y1={sourcePortCenter.y}
                  x2={cableState.mousePos.x}
                  y2={cableState.mousePos.y}
                  stroke="var(--accent-strong)"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  data-testid="rubber-band"
                  pointerEvents="none"
                />
              )}

            {nodes.length === 0 && (
              <text
                x={svgWidth / 2}
                y={svgHeight / 2}
                textAnchor="middle"
                fill="var(--canvas-empty)"
              >
                Empty canvas
              </text>
            )}

            {resolvedNodes.map((node) => {
              const x = node.position?.x ?? 32;
              const y = node.position?.y ?? 32;
              const status =
                nodeStatuses[node.id] ??
                (node.state?.desiredPower === "on" ? "running" : "stopped");
              const isSelected =
                selectedNodeIds.includes(node.id) || selectedNodeId === node.id;
              const borderColor =
                status === "running"
                  ? "var(--canvas-node-running)"
                  : status === "stopped"
                    ? "var(--canvas-node-stopped)"
                    : "var(--canvas-node-idle)";

              return (
                <g
                  key={node.id}
                  data-node-id={node.id}
                  data-testid={`node-${node.id}`}
                  style={{ cursor: onMoveNode ? "grab" : "default" }}
                >
                  <rect
                    x={x}
                    y={y}
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    fill="var(--canvas-node-fill)"
                    stroke={
                      isSelected ? "var(--canvas-node-selected)" : borderColor
                    }
                    strokeWidth={isSelected ? 3 : 2}
                    rx={10}
                    ry={10}
                  />
                  <text
                    x={x + NODE_WIDTH / 2}
                    y={y + NODE_HEIGHT / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={12}
                    fill="var(--canvas-node-text)"
                    pointerEvents="none"
                  >
                    {node.name}
                  </text>
                  <text
                    x={x + NODE_WIDTH / 2}
                    y={y + NODE_HEIGHT - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fill={borderColor}
                    data-testid={`status-${node.id}`}
                    pointerEvents="none"
                  >
                    {status}
                  </text>
                </g>
              );
            })}

            {selectionBox?.active ? (
              <rect
                x={Math.min(selectionBox.startX, selectionBox.currentX)}
                y={Math.min(selectionBox.startY, selectionBox.currentY)}
                width={Math.abs(selectionBox.currentX - selectionBox.startX)}
                height={Math.abs(selectionBox.currentY - selectionBox.startY)}
                fill="rgba(91, 149, 255, 0.12)"
                stroke="var(--canvas-node-selected)"
                strokeDasharray="6 3"
                data-testid="selection-box"
                pointerEvents="none"
              />
            ) : null}

            {links.map((link) => (
              <g key={`${link.id}-labels`} pointerEvents="none">
                {link.sourceLabel
                  ? (() => {
                      const pos = getCableLabelPosition(
                        link.x1,
                        link.y1,
                        link.x2,
                        link.y2,
                        "source",
                      );
                      return (
                        <g>
                          <rect
                            x={pos.x - 16}
                            y={pos.y - 10}
                            width={32}
                            height={14}
                            rx={7}
                            fill="rgba(10,16,28,0.88)"
                          />
                          <text
                            x={pos.x}
                            y={pos.y}
                            textAnchor="middle"
                            fontSize={10}
                            fontWeight={600}
                            fill="#dbe7f3"
                          >
                            {link.sourceLabel}
                          </text>
                        </g>
                      );
                    })()
                  : null}
                {link.targetLabel
                  ? (() => {
                      const pos = getCableLabelPosition(
                        link.x1,
                        link.y1,
                        link.x2,
                        link.y2,
                        "target",
                      );
                      return (
                        <g>
                          <rect
                            x={pos.x - 16}
                            y={pos.y - 10}
                            width={32}
                            height={14}
                            rx={7}
                            fill="rgba(10,16,28,0.88)"
                          />
                          <text
                            x={pos.x}
                            y={pos.y}
                            textAnchor="middle"
                            fontSize={10}
                            fontWeight={600}
                            fill="#dbe7f3"
                          >
                            {link.targetLabel}
                          </text>
                        </g>
                      );
                    })()
                  : null}
              </g>
            ))}

            {disconnectPopup && (
              <div
                className="disconnect-popup"
                data-testid="disconnect-popup"
                style={{
                  position: "absolute",
                  left: disconnectPopup.x,
                  top: disconnectPopup.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <span className="disconnect-popup-title">
                  {disconnectPopup.networkName}
                </span>
                <div className="disconnect-popup-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      const relatedAttachments = attachments.filter(
                        (a) => a.networkId === disconnectPopup.networkId,
                      );
                      void handleDisconnect(
                        relatedAttachments.map((a) => a.interfaceId),
                      );
                    }}
                  >
                    Disconnect
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setDisconnectPopup(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </g>
        </svg>
      </div>
      <ContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenu?.items ?? []}
        onClose={() => setContextMenu(null)}
      />
      {cableDialog ? (
        <div role="dialog" aria-label="Add Cable" className="confirm-overlay">
          <div className="confirm-dialog">
            <h2>Add Cable</h2>
            <p>
              Connect{" "}
              {
                resolvedNodes.find(
                  (node) => node.id === cableDialog.sourceNodeId,
                )?.name
              }{" "}
              to{" "}
              {
                resolvedNodes.find(
                  (node) => node.id === cableDialog.targetNodeId,
                )?.name
              }
            </p>
            <label className="field">
              <span className="field-label">Source Interface</span>
              <select
                className="field-input"
                aria-label="Source Interface"
                value={cableDialog.sourceInterfaceId}
                onChange={(e) =>
                  setCableDialog((current) =>
                    current
                      ? { ...current, sourceInterfaceId: e.target.value }
                      : current,
                  )
                }
              >
                {(
                  resolvedNodes.find(
                    (node) => node.id === cableDialog.sourceNodeId,
                  )?.interfaces ?? []
                ).map((iface) => (
                  <option key={iface.id} value={iface.id}>
                    {iface.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Destination Interface</span>
              <select
                className="field-input"
                aria-label="Destination Interface"
                value={cableDialog.targetInterfaceId}
                onChange={(e) =>
                  setCableDialog((current) =>
                    current
                      ? { ...current, targetInterfaceId: e.target.value }
                      : current,
                  )
                }
              >
                {(
                  resolvedNodes.find(
                    (node) => node.id === cableDialog.targetNodeId,
                  )?.interfaces ?? []
                ).map((iface) => (
                  <option key={iface.id} value={iface.id}>
                    {iface.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setCableDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => {
                  if (!labId || !onCreateNetwork || !onAttachInterfaces) return;
                  const sourceNode = resolvedNodes.find(
                    (node) => node.id === cableDialog.sourceNodeId,
                  );
                  const targetNode = resolvedNodes.find(
                    (node) => node.id === cableDialog.targetNodeId,
                  );
                  const networkName = `link-${sourceNode?.name ?? "node"}-${targetNode?.name ?? "node"}`;
                  const sourceInterfaceId = cableDialog.sourceInterfaceId;
                  const targetInterfaceId = cableDialog.targetInterfaceId;
                  setCableDialog(null);
                  void onCreateNetwork(labId, {
                    name: networkName,
                    visible: true,
                  })
                    .then((result) =>
                      onAttachInterfaces(labId, {
                        networkId: result.network.id,
                        interfaceIds: [sourceInterfaceId, targetInterfaceId],
                      }),
                    )
                    .then(() => onRefreshLab?.())
                    .catch(() => undefined);
                }}
              >
                Create Cable
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
