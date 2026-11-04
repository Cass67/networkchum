import {
  type ChangeEvent,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CanvasDrawing } from "@networkchum/shared";

import { ContextMenu } from "./ContextMenu.js";
import { DeviceIcon, getDeviceIconKind } from "../icons/deviceIcons.js";
import {
  DeviceRoleIconGlyph,
  type DeviceRoleIcon,
} from "../icons/deviceRoleIcons.js";

type CanvasNode = {
  id: string;
  name: string;
  runtime?: string;
  deviceRoleIcon?: DeviceRoleIcon;
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
  onMoveNodes?: (
    moves: Array<{ nodeId: string; position: { x: number; y: number } }>,
  ) => void | Promise<void>;
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
  onViewportCenterChange?: (center: { x: number; y: number }) => void;
  // Id of the loaded lab document; guards the initial fit while the fetch is
  // in flight so the previous lab's nodes are not fitted under the new id.
  documentLabId?: string | null;
  selectedCableId?: string | null;
  onSelectCable?: (networkId: string | null) => void;
  onDeleteCable?: (networkId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onPowerOnNode?: (nodeId: string) => void;
  onPowerOffNode?: (nodeId: string) => void;
  onOpenNativeConsole?: (nodeId: string) => void;
  onRenameNode?: (nodeId: string) => void;
  drawings?: CanvasDrawing[];
  onUpdateCanvasDrawings?: (drawings: CanvasDrawing[]) => void | Promise<void>;
};

const NODE_WIDTH = 100;
const NODE_HEIGHT = 48;
const NODE_GLYPH_SIZE = 48;
const NODE_GLYPH_MIN_SIZE = 32;
const NODE_GLYPH_MAX_SIZE = 80;
const NODE_LABEL_GAP = 16;
const NODE_STATUS_GAP = 14;
const NODE_ICON_BASE_SIZE = 16;
const NODE_CABLE_ANCHOR_GAP = 12;
const CABLE_LABEL_OFFSET = 16;
const MIN_VIEWPORT_SCALE = 0.5;
const MAX_VIEWPORT_SCALE = 2.5;
const VIEWPORT_ZOOM_STEP = 1.1;
const INITIAL_FIT_PADDING_X = 180;
const INITIAL_FIT_PADDING_Y = 140;
const INITIAL_FIT_THRESHOLD = 0.72;
const MIN_DRAWING_SIZE = 24;
const DEFAULT_DRAWING_COLOR = "#facc15";
const DEFAULT_SHAPE_STROKE = "#f8fafc";
const XHTML_NAMESPACE_PROPS = {
  xmlns: "http://www.w3.org/1999/xhtml",
} as HTMLAttributes<HTMLDivElement> & { xmlns: string };
function getNodeCenter(node: CanvasNode): { x: number; y: number } {
  return {
    x: (node.position?.x ?? 32) + NODE_WIDTH / 2,
    y: (node.position?.y ?? 32) + NODE_HEIGHT / 2,
  };
}

function getNodeStatusY(
  node: CanvasNode,
  glyphSize: number = NODE_GLYPH_SIZE,
): number {
  const center = getNodeCenter(node);
  const labelY = center.y + glyphSize / 2 + NODE_LABEL_GAP;
  return labelY + NODE_STATUS_GAP;
}

function getNodeCableAnchor(
  node: CanvasNode,
  target: { x: number; y: number },
  glyphSize: number = NODE_GLYPH_SIZE,
): { x: number; y: number } {
  const center = getNodeCenter(node);
  const dx = target.x - center.x;
  const dy = target.y - center.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      x:
        center.x +
        (dx >= 0
          ? glyphSize / 2 + NODE_CABLE_ANCHOR_GAP
          : -(glyphSize / 2 + NODE_CABLE_ANCHOR_GAP)),
      y: center.y,
    };
  }

  if (dy > 0) {
    return {
      x: center.x,
      y: getNodeStatusY(node, glyphSize) + NODE_CABLE_ANCHOR_GAP,
    };
  }

  if (dy < 0) {
    return {
      x: center.x,
      y: center.y - glyphSize / 2 - NODE_CABLE_ANCHOR_GAP,
    };
  }

  return {
    x: center.x,
    y: center.y - glyphSize / 2 - NODE_CABLE_ANCHOR_GAP,
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
  const horizontalBias = Math.abs(dx) > Math.abs(dy);

  if (side === "source") {
    return horizontalBias
      ? {
          x: x1 + (dx >= 0 ? CABLE_LABEL_OFFSET : -CABLE_LABEL_OFFSET),
          y: y1 - 8,
        }
      : {
          x: x1,
          y: y1 + (dy >= 0 ? CABLE_LABEL_OFFSET : -CABLE_LABEL_OFFSET),
        };
  }

  return horizontalBias
    ? {
        x: x2 + (dx >= 0 ? -CABLE_LABEL_OFFSET : CABLE_LABEL_OFFSET),
        y: y2 - 8,
      }
    : {
        x: x2,
        y: y2 + (dy >= 0 ? -CABLE_LABEL_OFFSET : CABLE_LABEL_OFFSET),
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
  glyphSize: number = NODE_GLYPH_SIZE,
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
      const c1 = getNodeCableAnchor(n1, getNodeCenter(n2), glyphSize);
      const c2 = getNodeCableAnchor(n2, getNodeCenter(n1), glyphSize);
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
        const c = getNodeCableAnchor(n, { x: midX, y: midY }, glyphSize);
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

type DrawingInteractionState = {
  active: boolean;
  mode: "move" | "resize";
  resizeHandle: ResizeHandle | null;
  drawingId: string | null;
  startX: number;
  startY: number;
  startDrawing: CanvasDrawing | null;
  latestDrawing: CanvasDrawing | null;
  containedNodeIds: string[];
  startNodePositions: Record<string, { x: number; y: number }>;
  containedDrawingIds: string[];
  startDrawingPositions: Record<string, { x: number; y: number }>;
};

type ResizeHandle = "nw" | "ne" | "sw" | "se";

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

type TextEditState = {
  drawingId: string;
  value: string;
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

function getCanvasPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  viewportOffset: { x: number; y: number },
  viewportScale: number,
): { x: number; y: number } {
  const svgPt = getSvgPoint(svg, clientX, clientY);
  return {
    x: (svgPt.x - viewportOffset.x) / viewportScale,
    y: (svgPt.y - viewportOffset.y) / viewportScale,
  };
}

function createDrawingId() {
  return `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sortDrawings(drawings: CanvasDrawing[]) {
  return [...drawings].sort((a, b) => a.zIndex - b.zIndex);
}

function resizeDrawing(
  drawing: CanvasDrawing,
  deltaX: number,
  deltaY: number,
  handle: ResizeHandle,
): CanvasDrawing {
  let left = drawing.x;
  let right = drawing.x + drawing.width;
  let top = drawing.y;
  let bottom = drawing.y + drawing.height;

  if (handle.includes("w")) {
    left = Math.min(right - MIN_DRAWING_SIZE, drawing.x + deltaX);
  } else {
    right = Math.max(left + MIN_DRAWING_SIZE, right + deltaX);
  }

  if (handle.includes("n")) {
    top = Math.min(bottom - MIN_DRAWING_SIZE, drawing.y + deltaY);
  } else {
    bottom = Math.max(top + MIN_DRAWING_SIZE, bottom + deltaY);
  }

  return {
    ...drawing,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function nodeCenterIsInsideDrawing(node: CanvasNode, drawing: CanvasDrawing) {
  const center = getNodeCenter(node);
  return (
    center.x >= drawing.x &&
    center.x <= drawing.x + drawing.width &&
    center.y >= drawing.y &&
    center.y <= drawing.y + drawing.height
  );
}

function drawingCenterIsInsideDrawing(
  candidate: CanvasDrawing,
  container: CanvasDrawing,
) {
  const center = {
    x: candidate.x + candidate.width / 2,
    y: candidate.y + candidate.height / 2,
  };
  return (
    candidate.id !== container.id &&
    !candidate.locked &&
    center.x >= container.x &&
    center.x <= container.x + container.width &&
    center.y >= container.y &&
    center.y <= container.y + container.height
  );
}

function getContentBounds(nodes: CanvasNode[], drawings: CanvasDrawing[]) {
  const bounds: Array<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }> = [];

  for (const node of nodes) {
    const x = node.position?.x ?? 32;
    const y = node.position?.y ?? 32;
    bounds.push({
      minX: x,
      minY: y,
      maxX: x + NODE_WIDTH,
      maxY: y + NODE_HEIGHT + NODE_LABEL_GAP + NODE_STATUS_GAP + 24,
    });
  }

  for (const drawing of drawings) {
    bounds.push({
      minX: drawing.x,
      minY: drawing.y,
      maxX: drawing.x + drawing.width,
      maxY: drawing.y + drawing.height,
    });
  }

  if (bounds.length === 0) return null;

  return bounds.reduce(
    (acc, entry) => ({
      minX: Math.min(acc.minX, entry.minX),
      minY: Math.min(acc.minY, entry.minY),
      maxX: Math.max(acc.maxX, entry.maxX),
      maxY: Math.max(acc.maxY, entry.maxY),
    }),
    bounds[0]!,
  );
}

function getInitialViewport(
  nodes: CanvasNode[],
  drawings: CanvasDrawing[],
  svgWidth: number,
  svgHeight: number,
) {
  const bounds = getContentBounds(nodes, drawings);
  if (!bounds) return null;

  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const shouldFit =
    width > svgWidth * INITIAL_FIT_THRESHOLD ||
    height > svgHeight * INITIAL_FIT_THRESHOLD ||
    bounds.minX < 0 ||
    bounds.minY < 0 ||
    bounds.maxX > svgWidth ||
    bounds.maxY > svgHeight;

  // Always centre the content; only shrink it when it does not fit.
  const scale = shouldFit
    ? Math.max(
        MIN_VIEWPORT_SCALE,
        Math.min(
          1,
          (svgWidth - INITIAL_FIT_PADDING_X * 2) / width,
          (svgHeight - INITIAL_FIT_PADDING_Y * 2) / height,
        ),
      )
    : 1;

  return {
    scale,
    offset: {
      x: (svgWidth - width * scale) / 2 - bounds.minX * scale,
      y: (svgHeight - height * scale) / 2 - bounds.minY * scale,
    },
  };
}

type ToolIconKind =
  | "rectangle"
  | "square"
  | "ellipse"
  | "circle"
  | "image"
  | "text"
  | "lock"
  | "unlock"
  | "forward"
  | "backward"
  | "delete";

function ToolIcon({ kind }: { kind: ToolIconKind }) {
  switch (kind) {
    case "rectangle":
      return <rect x="5" y="7" width="14" height="10" rx="1.5" />;
    case "square":
      return <rect x="6" y="6" width="12" height="12" rx="1.5" />;
    case "ellipse":
      return <ellipse cx="12" cy="12" rx="7" ry="5" />;
    case "circle":
      return <circle cx="12" cy="12" r="6" />;
    case "image":
      return (
        <>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M7 16l3.5-4 2.5 3 2-2.2L18 16" />
          <circle cx="9" cy="9" r="1" />
        </>
      );
    case "text":
      return <path d="M6 7h12M12 7v10M9 17h6" />;
    case "lock":
      return (
        <>
          <rect x="6" y="10" width="12" height="9" rx="2" />
          <path d="M8 10V8a4 4 0 0 1 8 0v2" />
        </>
      );
    case "unlock":
      return (
        <>
          <rect x="6" y="10" width="12" height="9" rx="2" />
          <path d="M8 10V8a4 4 0 0 1 7-2.6" />
        </>
      );
    case "forward":
      return (
        <>
          <rect x="7" y="9" width="8" height="8" rx="1" />
          <path d="M11 5h6v6" />
        </>
      );
    case "backward":
      return (
        <>
          <rect x="9" y="7" width="8" height="8" rx="1" />
          <path d="M7 13v6h6" />
        </>
      );
    case "delete":
      return (
        <>
          <path d="M6 7h12" />
          <path d="M9 7V5h6v2" />
          <path d="M8 10l1 9h6l1-9" />
        </>
      );
  }
}

function ToolButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ToolIconKind;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="canvas-tool-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ToolIcon kind={icon} />
      </svg>
    </button>
  );
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
  onMoveNodes,
  onCreateNetwork,
  onAttachInterfaces,
  onDetachInterface,
  onRefreshLab,
  onViewportCenterChange,
  documentLabId,
  onSelectCable,
  onDeleteCable,
  onDeleteNode,
  onPowerOnNode,
  onPowerOffNode,
  onOpenNativeConsole,
  onRenameNode,
  drawings = [],
  onUpdateCanvasDrawings,
}: TopologyCanvasProps) {
  const svgWidth = 1440;
  const svgHeight = 900;

  const fittedViewportLabRef = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textEditInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState>({
    dragging: false,
    nodeId: null,
    offsetX: 0,
    offsetY: 0,
    selectedIds: [],
    startPositions: {},
  });
  const drawingInteractionRef = useRef<DrawingInteractionState>({
    active: false,
    mode: "move",
    resizeHandle: null,
    drawingId: null,
    startX: 0,
    startY: 0,
    startDrawing: null,
    latestDrawing: null,
    containedNodeIds: [],
    startNodePositions: {},
    containedDrawingIds: [],
    startDrawingPositions: {},
  });
  const [pendingPositions, setPendingPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [pendingDrawings, setPendingDrawings] = useState<
    Record<string, CanvasDrawing>
  >({});
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(
    null,
  );
  const [textEdit, setTextEdit] = useState<TextEditState | null>(null);
  const [activeDrawingTool, setActiveDrawingTool] = useState<"text" | null>(
    null,
  );
  const [defaultDrawingColor, setDefaultDrawingColor] = useState(
    DEFAULT_DRAWING_COLOR,
  );
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(
    null,
  );
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(
    selectedNodeId ? [selectedNodeId] : [],
  );
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [viewportScale, setViewportScale] = useState(1);
  const [nodeGlyphSize, setNodeGlyphSize] = useState(NODE_GLYPH_SIZE);
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

  // Report the visible center so new nodes land where the user is looking.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !onViewportCenterChange) return;
    const report = () => {
      onViewportCenterChange({
        x: (svgWidth / 2 - viewportOffset.x) / viewportScale,
        y: (svgHeight / 2 - viewportOffset.y) / viewportScale,
      });
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [
    onViewportCenterChange,
    svgHeight,
    svgWidth,
    viewportOffset,
    viewportScale,
  ]);

  const resolvedNodes = nodes.map((n) => {
    const pending = pendingPositions[n.id];
    if (pending) return { ...n, position: pending };
    return n;
  });
  const resolvedDrawings = sortDrawings(
    drawings.map((drawing) => pendingDrawings[drawing.id] ?? drawing),
  );
  const selectedDrawing =
    resolvedDrawings.find((drawing) => drawing.id === selectedDrawingId) ??
    null;

  useEffect(() => {
    if (!labId || documentLabId !== labId) {
      return;
    }
    if (fittedViewportLabRef.current === labId) {
      return;
    }

    const initialViewport = getInitialViewport(
      nodes,
      drawings,
      svgWidth,
      svgHeight,
    );
    if (!initialViewport) {
      return;
    }

    fittedViewportLabRef.current = labId;
    setViewportScale(initialViewport.scale);
    setViewportOffset(initialViewport.offset);
  }, [documentLabId, drawings, labId, nodes, svgHeight, svgWidth]);

  useEffect(() => {
    if (!textEdit) return;
    textEditInputRef.current?.focus();
    textEditInputRef.current?.select();
  }, [textEdit]);

  const attachedInterfaceIds = new Set(attachments.map((a) => a.interfaceId));
  const interfaceNetworkMap = new Map(
    attachments.map((a) => [a.interfaceId, a.networkId]),
  );
  const networkMap = new Map(networks.map((n) => [n.id, n]));

  const links = buildLinks(resolvedNodes, networks, attachments, nodeGlyphSize);

  const commitDrawings = useCallback(
    (nextDrawings: CanvasDrawing[]) => {
      return onUpdateCanvasDrawings?.(nextDrawings);
    },
    [onUpdateCanvasDrawings],
  );

  const replaceDrawing = useCallback(
    (drawingId: string, update: (drawing: CanvasDrawing) => CanvasDrawing) => {
      commitDrawings(
        drawings.map((drawing) =>
          drawing.id === drawingId ? update(drawing) : drawing,
        ),
      );
    },
    [commitDrawings, drawings],
  );

  const clipboardDrawingRef = useRef<CanvasDrawing | null>(null);
  const pasteCountRef = useRef(0);

  const pasteDrawing = useCallback(
    (source: CanvasDrawing) => {
      const maxZIndex =
        drawings.reduce((max, drawing) => Math.max(max, drawing.zIndex), 0) + 1;
      const offset = 24 * (pasteCountRef.current + 1);
      const copy: CanvasDrawing = {
        ...source,
        id: createDrawingId(),
        x: source.x + offset,
        y: source.y + offset,
        zIndex: maxZIndex,
      };
      pasteCountRef.current += 1;
      setSelectedDrawingId(copy.id);
      commitDrawings([...drawings, copy]);
    },
    [commitDrawings, drawings],
  );

  // Copy/paste for the selected drawing via Cmd/Ctrl+C / Cmd/Ctrl+V. Document
  // level because the svg has no tabindex, so keystrokes never reach it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "v") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (key === "c") {
        const selected = drawings.find(
          (drawing) => drawing.id === selectedDrawingId,
        );
        if (selected) {
          clipboardDrawingRef.current = selected;
          pasteCountRef.current = 0;
        }
        return;
      }
      const source = clipboardDrawingRef.current;
      if (!source || !onUpdateCanvasDrawings) return;
      event.preventDefault();
      pasteDrawing(source);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawings, onUpdateCanvasDrawings, pasteDrawing, selectedDrawingId]);

  const handleAddShape = useCallback(
    (shape: "rectangle" | "square" | "ellipse" | "circle") => {
      const lockedAspect = shape === "square" || shape === "circle";
      const maxZIndex =
        drawings.reduce((max, drawing) => Math.max(max, drawing.zIndex), 0) + 1;
      const drawing: CanvasDrawing = {
        id: createDrawingId(),
        kind: "shape",
        shape,
        x: 160,
        y: 140,
        width: lockedAspect ? 160 : 240,
        height: lockedAspect ? 160 : 120,
        fill: defaultDrawingColor,
        stroke: DEFAULT_SHAPE_STROKE,
        opacity: 0.75,
        locked: false,
        zIndex: maxZIndex,
      };

      setSelectedDrawingId(drawing.id);
      commitDrawings([...drawings, drawing]);
    },
    [commitDrawings, defaultDrawingColor, drawings],
  );

  const placeTextDrawing = useCallback(
    (position: { x: number; y: number }) => {
      const maxZIndex =
        drawings.reduce((max, drawing) => Math.max(max, drawing.zIndex), 0) + 1;
      const drawing: CanvasDrawing = {
        id: createDrawingId(),
        kind: "text",
        x: position.x,
        y: position.y,
        width: 180,
        height: 56,
        text: "Label",
        fill: defaultDrawingColor,
        fontSize: 22,
        opacity: 1,
        locked: false,
        zIndex: maxZIndex,
      };

      setSelectedDrawingId(drawing.id);
      setActiveDrawingTool(null);
      setTextEdit({ drawingId: drawing.id, value: drawing.text });
      commitDrawings([...drawings, drawing]);
    },
    [commitDrawings, defaultDrawingColor, drawings],
  );

  const handleAddText = useCallback(() => {
    setActiveDrawingTool("text");
    setSelectedDrawingId(null);
    setSelectedNodeIds([]);
    onSelectNode?.(null);
    onSelectCable?.(null);
  }, [onSelectCable, onSelectNode]);

  const handleAddImageFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") {
          return;
        }
        const minZIndex =
          drawings.reduce((min, drawing) => Math.min(min, drawing.zIndex), 0) -
          1;
        const drawing: CanvasDrawing = {
          id: createDrawingId(),
          kind: "image",
          x: 120,
          y: 120,
          width: 420,
          height: 260,
          src: reader.result,
          opacity: 0.8,
          locked: false,
          zIndex: minZIndex,
        };
        setSelectedDrawingId(drawing.id);
        commitDrawings([...drawings, drawing]);
      };
      reader.readAsDataURL(file);
      event.target.value = "";
    },
    [commitDrawings, drawings],
  );

  const handleDrawingColorChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const fill = event.target.value;
      setDefaultDrawingColor(fill);
      if (selectedDrawing?.kind === "shape") {
        replaceDrawing(selectedDrawing.id, (drawing) =>
          drawing.kind === "shape" ? { ...drawing, fill } : drawing,
        );
      } else if (selectedDrawing?.kind === "text") {
        replaceDrawing(selectedDrawing.id, (drawing) =>
          drawing.kind === "text" ? { ...drawing, fill } : drawing,
        );
      }
    },
    [replaceDrawing, selectedDrawing],
  );

  const handleDeleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return;
    commitDrawings(
      drawings.filter((drawing) => drawing.id !== selectedDrawingId),
    );
    setSelectedDrawingId(null);
  }, [commitDrawings, drawings, selectedDrawingId]);

  const commitTextEdit = useCallback(() => {
    if (!textEdit) return;
    const nextText = textEdit.value.trim() || "Label";
    commitDrawings(
      drawings.map((drawing) =>
        drawing.id === textEdit.drawingId && drawing.kind === "text"
          ? { ...drawing, text: nextText }
          : drawing,
      ),
    );
    setTextEdit(null);
  }, [commitDrawings, drawings, textEdit]);

  const handleToggleSelectedDrawingLock = useCallback(() => {
    if (!selectedDrawingId) return;
    replaceDrawing(selectedDrawingId, (drawing) => ({
      ...drawing,
      locked: !drawing.locked,
    }));
  }, [replaceDrawing, selectedDrawingId]);

  const handleBringDrawingForward = useCallback(
    (drawingId: string) => {
      const nextZ =
        drawings.reduce((max, drawing) => Math.max(max, drawing.zIndex), 0) + 1;
      replaceDrawing(drawingId, (drawing) => ({ ...drawing, zIndex: nextZ }));
    },
    [drawings, replaceDrawing],
  );

  const handleSendDrawingBackward = useCallback(
    (drawingId: string) => {
      const nextZ =
        drawings.reduce((min, drawing) => Math.min(min, drawing.zIndex), 0) - 1;
      replaceDrawing(drawingId, (drawing) => ({ ...drawing, zIndex: nextZ }));
    },
    [drawings, replaceDrawing],
  );

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
          ?.id ?? ""
      );
    },
    [attachedInterfaceIds],
  );

  const handleSvgMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const target = e.target as SVGElement;
      const svg = svgRef.current;

      if (activeDrawingTool === "text" && svg && onUpdateCanvasDrawings) {
        const point = getCanvasPoint(
          svg,
          e.clientX,
          e.clientY,
          viewportOffset,
          viewportScale,
        );
        placeTextDrawing(point);
        syncSingleSelection(null);
        onSelectCable?.(null);
        setDisconnectPopup(null);
        e.preventDefault();
        return;
      }

      const resizeEl = target.closest<SVGElement>("[data-drawing-resize-id]");
      if (resizeEl) {
        const drawingId = resizeEl.getAttribute("data-drawing-resize-id")!;
        const resizeHandle =
          (resizeEl.getAttribute(
            "data-drawing-resize-handle",
          ) as ResizeHandle | null) ?? "se";
        const drawing = resolvedDrawings.find(
          (entry) => entry.id === drawingId,
        );
        if (!drawing || drawing.locked || !svg || !onUpdateCanvasDrawings) {
          return;
        }
        const svgPt = getCanvasPoint(
          svg,
          e.clientX,
          e.clientY,
          viewportOffset,
          viewportScale,
        );
        setSelectedDrawingId(drawingId);
        drawingInteractionRef.current = {
          active: true,
          mode: "resize",
          resizeHandle,
          drawingId,
          startX: svgPt.x,
          startY: svgPt.y,
          startDrawing: drawing,
          latestDrawing: null,
          containedNodeIds: [],
          startNodePositions: {},
          containedDrawingIds: [],
          startDrawingPositions: {},
        };
        syncSingleSelection(null);
        onSelectCable?.(null);
        e.preventDefault();
        return;
      }

      const drawingEl = target.closest<SVGElement>("[data-drawing-id]");
      if (drawingEl) {
        const drawingId = drawingEl.getAttribute("data-drawing-id")!;
        const drawing = resolvedDrawings.find(
          (entry) => entry.id === drawingId,
        );
        setSelectedDrawingId(drawingId);
        syncSingleSelection(null);
        onSelectCable?.(null);
        setDisconnectPopup(null);
        if (!drawing || !svg || !onUpdateCanvasDrawings) {
          return;
        }
        const svgPt = getCanvasPoint(
          svg,
          e.clientX,
          e.clientY,
          viewportOffset,
          viewportScale,
        );
        const containedNodeIds = drawing.locked
          ? resolvedNodes
              .filter((node) => nodeCenterIsInsideDrawing(node, drawing))
              .map((node) => node.id)
          : [];
        const containedDrawingIds = drawing.locked
          ? resolvedDrawings
              .filter((entry) => drawingCenterIsInsideDrawing(entry, drawing))
              .map((entry) => entry.id)
          : [];
        drawingInteractionRef.current = {
          active: true,
          mode: "move",
          resizeHandle: null,
          drawingId,
          startX: svgPt.x,
          startY: svgPt.y,
          startDrawing: drawing,
          latestDrawing: null,
          containedNodeIds,
          startNodePositions: Object.fromEntries(
            containedNodeIds.map((nodeId) => {
              const node = resolvedNodes.find((entry) => entry.id === nodeId);
              return [
                nodeId,
                {
                  x: node?.position?.x ?? 32,
                  y: node?.position?.y ?? 32,
                },
              ];
            }),
          ),
          containedDrawingIds,
          startDrawingPositions: Object.fromEntries(
            containedDrawingIds.map((containedDrawingId) => {
              const containedDrawing = resolvedDrawings.find(
                (entry) => entry.id === containedDrawingId,
              );
              return [
                containedDrawingId,
                {
                  x: containedDrawing?.x ?? 0,
                  y: containedDrawing?.y ?? 0,
                },
              ];
            }),
          ),
        };
        e.preventDefault();
        return;
      }

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
          const svgPt = getCanvasPoint(
            svg,
            e.clientX,
            e.clientY,
            viewportOffset,
            viewportScale,
          );
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
        if (e.shiftKey) {
          const svg = svgRef.current;
          if (!svg) return;
          const svgPt = getCanvasPoint(
            svg,
            e.clientX,
            e.clientY,
            viewportOffset,
            viewportScale,
          );
          setSelectionBox({
            active: true,
            startX: svgPt.x,
            startY: svgPt.y,
            currentX: svgPt.x,
            currentY: svgPt.y,
          });
        } else {
          setPanState({
            active: true,
            startClientX: e.clientX,
            startClientY: e.clientY,
            originX: viewportOffset.x,
            originY: viewportOffset.y,
          });
        }
      }

      setDisconnectPopup(null);
      setSelectedDrawingId(null);
      syncSingleSelection(null);
      onSelectCable?.(null);
    },
    [
      cableState.mode,
      activeDrawingTool,
      onMoveNode,
      onSelectCable,
      resolvedNodes,
      links,
      syncSingleSelection,
      selectedNodeIds,
      resolvedDrawings,
      onUpdateCanvasDrawings,
      spaceHeld,
      viewportOffset,
      viewportScale,
      placeTextDrawing,
    ],
  );

  const handleSvgMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;
      const svgPt = getCanvasPoint(
        svg,
        e.clientX,
        e.clientY,
        viewportOffset,
        viewportScale,
      );

      if (drawingInteractionRef.current.active) {
        const interaction = drawingInteractionRef.current;
        if (!interaction.drawingId || !interaction.startDrawing) return;
        const deltaX = svgPt.x - interaction.startX;
        const deltaY = svgPt.y - interaction.startY;
        const nextDrawing =
          interaction.mode === "resize"
            ? resizeDrawing(
                interaction.startDrawing,
                deltaX,
                deltaY,
                interaction.resizeHandle ?? "se",
              )
            : {
                ...interaction.startDrawing,
                x: interaction.startDrawing.x + deltaX,
                y: interaction.startDrawing.y + deltaY,
              };
        interaction.latestDrawing = nextDrawing;
        setPendingDrawings((prev) => ({
          ...prev,
          [interaction.drawingId!]: nextDrawing,
          ...Object.fromEntries(
            interaction.containedDrawingIds
              .map((drawingId) => {
                const original = drawings.find(
                  (drawing) => drawing.id === drawingId,
                );
                const start = interaction.startDrawingPositions[drawingId];
                if (!original || !start) return null;
                return [
                  drawingId,
                  { ...original, x: start.x + deltaX, y: start.y + deltaY },
                ] as const;
              })
              .filter((entry) => entry !== null),
          ),
        }));
        if (
          interaction.mode === "move" &&
          interaction.containedNodeIds.length
        ) {
          setPendingPositions((prev) => {
            const next = { ...prev };
            for (const nodeId of interaction.containedNodeIds) {
              const start = interaction.startNodePositions[nodeId];
              if (start) {
                next[nodeId] = { x: start.x + deltaX, y: start.y + deltaY };
              }
            }
            return next;
          });
        }
        return;
      }

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
    [
      cableState.mode,
      selectionBox?.active,
      panState,
      viewportOffset,
      viewportScale,
    ],
  );

  const handleSvgMouseUp = useCallback(
    async (e: React.MouseEvent<SVGSVGElement>) => {
      if (panState?.active) {
        setPanState(null);
        return;
      }

      if (drawingInteractionRef.current.active) {
        const interaction = drawingInteractionRef.current;
        const drawingId = interaction.drawingId;
        const finalDrawing = drawingId
          ? (interaction.latestDrawing ?? pendingDrawings[drawingId])
          : undefined;
        const finalDrawings =
          drawingId && finalDrawing
            ? drawings.map((drawing) =>
                drawing.id === drawingId
                  ? finalDrawing
                  : (pendingDrawings[drawing.id] ?? drawing),
              )
            : null;
        const moves =
          interaction.mode === "move" && interaction.containedNodeIds.length
            ? interaction.containedNodeIds
                .map((nodeId) => {
                  const start = interaction.startNodePositions[nodeId];
                  if (!start || !finalDrawing || !interaction.startDrawing) {
                    return null;
                  }
                  return {
                    nodeId,
                    position: {
                      x: start.x + finalDrawing.x - interaction.startDrawing.x,
                      y: start.y + finalDrawing.y - interaction.startDrawing.y,
                    },
                  };
                })
                .filter((move) => move !== null)
            : [];
        const containedNodeIds = interaction.containedNodeIds;
        const containedDrawingIds = interaction.containedDrawingIds;

        drawingInteractionRef.current = {
          active: false,
          mode: "move",
          resizeHandle: null,
          drawingId: null,
          startX: 0,
          startY: 0,
          startDrawing: null,
          latestDrawing: null,
          containedNodeIds: [],
          startNodePositions: {},
          containedDrawingIds: [],
          startDrawingPositions: {},
        };

        if (finalDrawings) {
          try {
            await commitDrawings(finalDrawings);
          } catch {
            /* keep optimistic canvas edits in place */
          }
        }
        let nodeMoveSaved = true;
        if (moves.length > 0) {
          try {
            if (onMoveNodes) {
              await onMoveNodes(moves);
            } else if (onMoveNode) {
              for (const move of moves) {
                await onMoveNode(move.nodeId, move.position);
              }
            }
          } catch {
            nodeMoveSaved = false;
            /* keep optimistic node positions in place until the next refresh */
          }
        }
        setPendingDrawings((prev) => {
          if (!drawingId) return prev;
          const next = { ...prev };
          delete next[drawingId];
          for (const containedDrawingId of containedDrawingIds) {
            delete next[containedDrawingId];
          }
          return next;
        });
        if (nodeMoveSaved) {
          setPendingPositions((prev) => {
            const next = { ...prev };
            for (const nodeId of containedNodeIds) {
              delete next[nodeId];
            }
            return next;
          });
        }
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
      pendingDrawings,
      drawings,
      commitDrawings,
      onMoveNode,
      onMoveNodes,
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
        if (activeDrawingTool) {
          setActiveDrawingTool(null);
          return;
        }
        if (cableState.mode === "drawing") {
          clearCable();
          return;
        }
        setDisconnectPopup(null);
        setSelectedDrawingId(null);
        syncSingleSelection(null);
      }
      if (e.key === " ") {
        setSpaceHeld(true);
      }
    },
    [activeDrawingTool, cableState.mode, clearCable, syncSingleSelection],
  );

  const handleKeyUp = useCallback((e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key === " ") {
      setSpaceHeld(false);
      setPanState(null);
    }
  }, []);

  const handleSvgWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg) return;

      e.preventDefault();

      const nextScale = Math.max(
        MIN_VIEWPORT_SCALE,
        Math.min(
          MAX_VIEWPORT_SCALE,
          viewportScale *
            (e.deltaY < 0 ? VIEWPORT_ZOOM_STEP : 1 / VIEWPORT_ZOOM_STEP),
        ),
      );

      if (nextScale === viewportScale) {
        return;
      }

      const svgPt = getSvgPoint(svg, e.clientX, e.clientY);
      const canvasPoint = {
        x: (svgPt.x - viewportOffset.x) / viewportScale,
        y: (svgPt.y - viewportOffset.y) / viewportScale,
      };

      setViewportScale(nextScale);
      setViewportOffset({
        x: svgPt.x - canvasPoint.x * nextScale,
        y: svgPt.y - canvasPoint.y * nextScale,
      });
    },
    [viewportOffset, viewportScale],
  );

  const handleSvgDoubleClick = useCallback(
    (event: React.MouseEvent<SVGSVGElement>) => {
      const target = event.target as SVGElement;
      const drawingEl = target.closest<SVGElement>("[data-drawing-id]");
      if (drawingEl) {
        const drawingId = drawingEl.getAttribute("data-drawing-id")!;
        const drawing = resolvedDrawings.find(
          (entry) => entry.id === drawingId,
        );
        if (drawing?.kind === "text" && !drawing.locked) {
          setSelectedDrawingId(drawing.id);
          syncSingleSelection(null);
          onSelectCable?.(null);
          setTextEdit({ drawingId: drawing.id, value: drawing.text });
          event.preventDefault();
        }
        return;
      }

      const nodeGroup = target.closest<SVGGElement>("[data-node-id]");
      const nodeId = nodeGroup?.getAttribute("data-node-id");
      if (nodeId) {
        onOpenNativeConsole?.(nodeId);
      }
    },
    [onOpenNativeConsole, onSelectCable, resolvedDrawings, syncSingleSelection],
  );

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

      const drawingEl = target.closest<SVGElement>("[data-drawing-id]");
      if (drawingEl) {
        const drawingId = drawingEl.getAttribute("data-drawing-id")!;
        const drawing = resolvedDrawings.find(
          (entry) => entry.id === drawingId,
        );
        setSelectedDrawingId(drawingId);
        syncSingleSelection(null);
        onSelectCable?.(null);
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            {
              label: drawing?.locked ? "Unlock" : "Lock",
              onSelect: () =>
                replaceDrawing(drawingId, (entry) => ({
                  ...entry,
                  locked: !entry.locked,
                })),
            },
            {
              label: "Bring Forward",
              onSelect: () => handleBringDrawingForward(drawingId),
            },
            {
              label: "Send Backward",
              onSelect: () => handleSendDrawingBackward(drawingId),
            },
            {
              label: "Copy",
              onSelect: () => {
                clipboardDrawingRef.current = drawing ?? null;
                pasteCountRef.current = 0;
              },
            },
            ...(clipboardDrawingRef.current
              ? [
                  {
                    label: "Paste",
                    onSelect: () => {
                      const source = clipboardDrawingRef.current;
                      if (source) pasteDrawing(source);
                    },
                  },
                ]
              : []),
            {
              label: "Delete Drawing",
              onSelect: () => {
                commitDrawings(
                  drawings.filter((entry) => entry.id !== drawingId),
                );
                setSelectedDrawingId(null);
              },
            },
          ],
        });
        return;
      }

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
                const svgPt = getCanvasPoint(
                  svg,
                  e.clientX,
                  e.clientY,
                  viewportOffset,
                  viewportScale,
                );
                setCableState({
                  mode: "drawing",
                  sourceNodeId: nodeId,
                  mousePos: svgPt,
                });
              },
            },
            { label: "Rename", onSelect: () => onRenameNode?.(nodeId) },
            ...(node?.runtime === "lab-bridge"
              ? []
              : [
                  status === "running"
                    ? {
                        label: "Power Off",
                        onSelect: () => onPowerOffNode?.(nodeId),
                      }
                    : {
                        label: "Power On",
                        onSelect: () => onPowerOnNode?.(nodeId),
                      },
                ]),
            { label: "Delete Node", onSelect: () => onDeleteNode?.(nodeId) },
          ],
        });
        syncSingleSelection(nodeId);
        onSelectCable?.(null);
        return;
      }

      setContextMenu(null);
    },
    [
      attachments,
      commitDrawings,
      drawings,
      handleBringDrawingForward,
      handleDisconnect,
      handleSendDrawingBackward,
      nodeStatuses,
      onDeleteCable,
      onDeleteNode,
      onPowerOffNode,
      onPowerOnNode,
      onRenameNode,
      onSelectCable,
      pasteDrawing,
      replaceDrawing,
      resolvedDrawings,
      resolvedNodes,
      syncSingleSelection,
      viewportOffset,
      viewportScale,
    ],
  );

  const sourcePortCenter = (() => {
    if (cableState.mode !== "drawing" || !cableState.sourceNodeId) return null;
    const sourceNode = nodes.find((n) => n.id === cableState.sourceNodeId);
    if (!sourceNode) return null;
    const resolvedSourceNode =
      resolvedNodes.find((n) => n.id === sourceNode.id) ?? sourceNode;
    return getNodeCableAnchor(
      resolvedSourceNode,
      cableState.mousePos ?? getNodeCenter(resolvedSourceNode),
      nodeGlyphSize,
    );
  })();

  const isDragging = Object.keys(pendingPositions).length > 0;
  const isDrawingDragging =
    drawingInteractionRef.current.active ||
    Object.keys(pendingDrawings).length > 0;
  const cableSourceNode = cableDialog
    ? resolvedNodes.find((node) => node.id === cableDialog.sourceNodeId)
    : undefined;
  const cableTargetNode = cableDialog
    ? resolvedNodes.find((node) => node.id === cableDialog.targetNodeId)
    : undefined;
  const freeSourceInterfaces =
    cableSourceNode?.interfaces?.filter(
      (iface) => !attachedInterfaceIds.has(iface.id),
    ) ?? [];
  const freeTargetInterfaces =
    cableTargetNode?.interfaces?.filter(
      (iface) => !attachedInterfaceIds.has(iface.id),
    ) ?? [];
  const canCreateCable =
    Boolean(cableDialog?.sourceInterfaceId) &&
    Boolean(cableDialog?.targetInterfaceId) &&
    !attachedInterfaceIds.has(cableDialog?.sourceInterfaceId ?? "") &&
    !attachedInterfaceIds.has(cableDialog?.targetInterfaceId ?? "");
  const selectedShapeFill =
    selectedDrawing?.kind === "shape" || selectedDrawing?.kind === "text"
      ? selectedDrawing.fill
      : defaultDrawingColor;

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
        <div
          className="canvas-drawing-toolbar canvas-drawing-dock"
          aria-label="Drawing Tools"
        >
          <label className="canvas-color-field">
            <span className="sr-only">Drawing Color</span>
            <input
              type="color"
              aria-label="Drawing Color"
              value={selectedShapeFill}
              onChange={handleDrawingColorChange}
            />
          </label>
          <label className="canvas-icon-size-field">
            <span className="sr-only">Icon Size</span>
            <input
              type="range"
              aria-label="Icon Size"
              min={NODE_GLYPH_MIN_SIZE}
              max={NODE_GLYPH_MAX_SIZE}
              step={4}
              value={nodeGlyphSize}
              onChange={(event) => setNodeGlyphSize(Number(event.target.value))}
              data-testid="icon-size-slider"
            />
          </label>
          <ToolButton
            label="Add Rectangle"
            icon="rectangle"
            onClick={() => handleAddShape("rectangle")}
          />
          <ToolButton
            label="Add Square"
            icon="square"
            onClick={() => handleAddShape("square")}
          />
          <ToolButton
            label="Add Ellipse"
            icon="ellipse"
            onClick={() => handleAddShape("ellipse")}
          />
          <ToolButton
            label="Add Circle"
            icon="circle"
            onClick={() => handleAddShape("circle")}
          />
          <ToolButton label="Add Text" icon="text" onClick={handleAddText} />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label="Background Image File"
            onChange={handleAddImageFile}
          />
          <ToolButton
            label="Add Background Image"
            icon="image"
            onClick={() => imageInputRef.current?.click()}
          />
          {selectedDrawing ? (
            <>
              <ToolButton
                label={selectedDrawing.locked ? "Unlock" : "Lock"}
                icon={selectedDrawing.locked ? "unlock" : "lock"}
                onClick={handleToggleSelectedDrawingLock}
              />
              <ToolButton
                label="Bring Forward"
                icon="forward"
                onClick={() => handleBringDrawingForward(selectedDrawing.id)}
              />
              <ToolButton
                label="Send Backward"
                icon="backward"
                onClick={() => handleSendDrawingBackward(selectedDrawing.id)}
              />
              <ToolButton
                label="Delete Drawing"
                icon="delete"
                onClick={handleDeleteSelectedDrawing}
              />
            </>
          ) : null}
        </div>
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="xMidYMid meet"
          className="canvas-svg"
          style={{
            cursor: panState?.active
              ? "grabbing"
              : spaceHeld
                ? "grab"
                : isDragging || isDrawingDragging
                  ? "grabbing"
                  : cableState.mode === "drawing" ||
                      activeDrawingTool === "text"
                    ? "crosshair"
                    : "default",
          }}
          data-testid="topology-svg"
          role="application"
          aria-label={labName ? `${labName} topology` : "Topology canvas"}
          onMouseDown={handleSvgMouseDown}
          onDoubleClick={handleSvgDoubleClick}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onWheel={handleSvgWheel}
          onContextMenu={handleSvgContextMenu}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          focusable
        >
          <g
            data-testid="viewport-layer"
            transform={`translate(${viewportOffset.x} ${viewportOffset.y}) scale(${viewportScale})`}
          >
            {resolvedDrawings.map((drawing) => {
              const isSelected = drawing.id === selectedDrawingId;
              const drawingCursor = onUpdateCanvasDrawings ? "move" : "default";
              return (
                <g key={drawing.id}>
                  {drawing.kind === "image" ? (
                    <image
                      href={drawing.src}
                      x={drawing.x}
                      y={drawing.y}
                      width={drawing.width}
                      height={drawing.height}
                      preserveAspectRatio="none"
                      opacity={drawing.opacity}
                      data-drawing-id={drawing.id}
                      data-testid={`drawing-${drawing.id}`}
                      style={{ cursor: drawingCursor }}
                    />
                  ) : drawing.kind === "text" ? (
                    <g
                      data-drawing-id={drawing.id}
                      data-testid={`drawing-${drawing.id}`}
                      fill={drawing.fill}
                      style={{ cursor: drawingCursor }}
                    >
                      <rect
                        x={drawing.x}
                        y={drawing.y}
                        width={drawing.width}
                        height={drawing.height}
                        fill="transparent"
                      />
                      {textEdit?.drawingId === drawing.id ? (
                        <foreignObject
                          x={drawing.x}
                          y={drawing.y}
                          width={drawing.width}
                          height={drawing.height}
                          data-testid={`drawing-text-editor-${drawing.id}`}
                        >
                          <div
                            className="canvas-inline-text-editor-frame"
                            style={{
                              display: "block",
                              width: "100%",
                              height: "100%",
                            }}
                            {...XHTML_NAMESPACE_PROPS}
                          >
                            <input
                              ref={textEditInputRef}
                              className="canvas-inline-text-editor"
                              aria-label="Edit Text Drawing"
                              value={textEdit.value}
                              onMouseDown={(event) => event.stopPropagation()}
                              onDoubleClick={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                setTextEdit((current) =>
                                  current
                                    ? { ...current, value: event.target.value }
                                    : current,
                                )
                              }
                              onBlur={commitTextEdit}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  commitTextEdit();
                                }
                                if (event.key === "Escape") {
                                  setTextEdit(null);
                                }
                              }}
                              style={{
                                boxSizing: "border-box",
                                color: drawing.fill,
                                display: "block",
                                fontSize: drawing.fontSize,
                                height: "100%",
                                minWidth: 0,
                                width: "100%",
                              }}
                            />
                          </div>
                        </foreignObject>
                      ) : (
                        <text
                          x={drawing.x + drawing.width / 2}
                          y={drawing.y + drawing.height / 2}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fill={drawing.fill}
                          fontSize={drawing.fontSize}
                          fontWeight={800}
                          opacity={drawing.opacity}
                          pointerEvents="none"
                        >
                          {drawing.text}
                        </text>
                      )}
                    </g>
                  ) : drawing.shape === "ellipse" ||
                    drawing.shape === "circle" ? (
                    <ellipse
                      cx={drawing.x + drawing.width / 2}
                      cy={drawing.y + drawing.height / 2}
                      rx={drawing.width / 2}
                      ry={drawing.height / 2}
                      fill={drawing.fill}
                      stroke={drawing.stroke}
                      strokeWidth={2}
                      opacity={drawing.opacity}
                      data-drawing-id={drawing.id}
                      data-testid={`drawing-${drawing.id}`}
                      style={{ cursor: drawingCursor }}
                    />
                  ) : (
                    <rect
                      x={drawing.x}
                      y={drawing.y}
                      width={drawing.width}
                      height={drawing.height}
                      fill={drawing.fill}
                      stroke={drawing.stroke}
                      strokeWidth={2}
                      opacity={drawing.opacity}
                      data-drawing-id={drawing.id}
                      data-testid={`drawing-${drawing.id}`}
                      style={{ cursor: drawingCursor }}
                    />
                  )}
                </g>
              );
            })}

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
              const center = getNodeCenter(node);
              const status =
                node.runtime === "lab-bridge"
                  ? "bridged"
                  : (nodeStatuses[node.id] ??
                    (node.state?.desiredPower === "on"
                      ? "running"
                      : "stopped"));
              const isSelected =
                selectedNodeIds.includes(node.id) || selectedNodeId === node.id;
              const borderColor =
                status === "running"
                  ? "var(--canvas-node-running)"
                  : status === "stopped"
                    ? "var(--canvas-node-stopped)"
                    : "var(--canvas-node-idle)";
              const outlineColor = isSelected
                ? "var(--canvas-node-selected)"
                : borderColor;
              const labelY = center.y + nodeGlyphSize / 2 + NODE_LABEL_GAP;
              const statusY = getNodeStatusY(node, nodeGlyphSize);
              const hitboxHeight = statusY - y + 10;
              const iconScale = nodeGlyphSize / NODE_ICON_BASE_SIZE;

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
                    height={hitboxHeight}
                    fill="transparent"
                    data-testid={`node-hitbox-${node.id}`}
                  />
                  <g
                    data-testid={`node-body-${node.id}`}
                    data-outline-color={outlineColor}
                    transform={`translate(${center.x - nodeGlyphSize / 2} ${center.y - nodeGlyphSize / 2}) scale(${iconScale})`}
                    style={{
                      filter: "none",
                    }}
                    pointerEvents="none"
                  >
                    {node.deviceRoleIcon ? (
                      <DeviceRoleIconGlyph
                        kind={node.deviceRoleIcon}
                        testId={`canvas-node-${node.deviceRoleIcon}-${node.id}`}
                      />
                    ) : (
                      <DeviceIcon
                        kind={getDeviceIconKind(node.runtime)}
                        testId={`node-icon-${node.id}`}
                      />
                    )}
                  </g>
                  <text
                    x={center.x}
                    y={labelY}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={12}
                    fontWeight={isSelected ? 600 : 400}
                    fill={isSelected ? outlineColor : "var(--canvas-node-text)"}
                  >
                    {node.name}
                  </text>
                  <text
                    x={center.x}
                    y={statusY}
                    textAnchor="middle"
                    fontSize={10}
                    fill={borderColor}
                    data-testid={`status-${node.id}`}
                  >
                    {status}
                  </text>
                </g>
              );
            })}

            {selectedDrawing ? (
              <g data-testid="drawing-selection-overlay">
                <rect
                  x={selectedDrawing.x - 4}
                  y={selectedDrawing.y - 4}
                  width={selectedDrawing.width + 8}
                  height={selectedDrawing.height + 8}
                  fill="none"
                  stroke="var(--canvas-node-selected)"
                  strokeDasharray="6 3"
                  pointerEvents="none"
                />
                {!selectedDrawing.locked && onUpdateCanvasDrawings
                  ? (["nw", "ne", "sw", "se"] as const).map((handle) => {
                      const x = handle.includes("w")
                        ? selectedDrawing.x - 6
                        : selectedDrawing.x + selectedDrawing.width - 6;
                      const y = handle.includes("n")
                        ? selectedDrawing.y - 6
                        : selectedDrawing.y + selectedDrawing.height - 6;
                      const cursor =
                        handle === "nw" || handle === "se"
                          ? "nwse-resize"
                          : "nesw-resize";
                      return (
                        <rect
                          key={handle}
                          x={x}
                          y={y}
                          width={12}
                          height={12}
                          fill="var(--accent-strong)"
                          stroke="var(--panel-bg-strong)"
                          strokeWidth={2}
                          data-drawing-resize-id={selectedDrawing.id}
                          data-drawing-resize-handle={handle}
                          data-testid={
                            handle === "se"
                              ? `drawing-resize-${selectedDrawing.id}`
                              : `drawing-resize-${handle}-${selectedDrawing.id}`
                          }
                          style={{ cursor }}
                        />
                      );
                    })
                  : null}
              </g>
            ) : null}

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
              Connect {cableSourceNode?.name} to {cableTargetNode?.name}
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
                {freeSourceInterfaces.length === 0 ? (
                  <option value="">No free interfaces</option>
                ) : null}
                {freeSourceInterfaces.map((iface) => (
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
                {freeTargetInterfaces.length === 0 ? (
                  <option value="">No free interfaces</option>
                ) : null}
                {freeTargetInterfaces.map((iface) => (
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
                disabled={!canCreateCable}
                onClick={() => {
                  if (!labId || !onCreateNetwork || !onAttachInterfaces) return;
                  if (!canCreateCable) return;
                  const networkName = `link-${cableSourceNode?.name ?? "node"}-${cableTargetNode?.name ?? "node"}`;
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
