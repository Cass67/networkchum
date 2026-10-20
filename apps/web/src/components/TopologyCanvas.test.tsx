import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TopologyCanvas } from "./TopologyCanvas.js";

function mockSvgPoint(svgElement: HTMLElement) {
  const svg = svgElement as any;
  let ptX = 0;
  let ptY = 0;
  svg.createSVGPoint = () => ({
    get x() {
      return ptX;
    },
    set x(v: number) {
      ptX = v;
    },
    get y() {
      return ptY;
    },
    set y(v: number) {
      ptY = v;
    },
    matrixTransform: () => ({ x: ptX, y: ptY }),
  });
  svg.getScreenCTM = () => ({
    inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  });
}

function parseViewportTransform(transform: string | null) {
  const match = transform?.match(
    /^translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)$/,
  );
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2]),
    scale: Number(match[3]),
  };
}

afterEach(() => {
  cleanup();
});

describe("TopologyCanvas", () => {
  const nodes = [
    { id: "n1", name: "Router-1", position: { x: 50, y: 50 } },
    { id: "n2", name: "Router-2", position: { x: 250, y: 50 } },
  ];

  it("renders nodes with names", () => {
    render(<TopologyCanvas labName="Test Lab" labId="lab-1" nodes={nodes} />);

    expect(screen.getByTestId("node-n1")).toBeInTheDocument();
    expect(screen.getByTestId("node-n2")).toBeInTheDocument();
    expect(screen.getByText("Router-1")).toBeInTheDocument();
    expect(screen.getByText("Router-2")).toBeInTheDocument();
  });

  it("renders empty canvas when no nodes", () => {
    render(<TopologyCanvas labName="Empty" labId="lab-1" nodes={[]} />);

    expect(screen.getByText("Empty canvas")).toBeInTheDocument();
  });

  it("renders links between connected nodes", () => {
    const networks = [
      { id: "net-1", kind: "ethernet", name: "LAN", visible: true },
    ];
    const attachments = [
      { interfaceId: "eth0", networkId: "net-1" },
      { interfaceId: "eth0-n2", networkId: "net-1" },
    ];
    const nodesWithIface = [
      {
        id: "n1",
        name: "R1",
        position: { x: 50, y: 50 },
        interfaces: [{ id: "eth0", name: "eth0", slot: 0 }],
      },
      {
        id: "n2",
        name: "R2",
        position: { x: 250, y: 50 },
        interfaces: [{ id: "eth0-n2", name: "eth0", slot: 0 }],
      },
    ];

    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={nodesWithIface}
        networks={networks}
        attachments={attachments}
      />,
    );

    expect(screen.getByTestId("link-net-1")).toBeInTheDocument();
    expect(screen.getAllByText("eth0")).toHaveLength(2);
  });

  it("anchors vertical cables below the source labels and above the target labels", () => {
    const networks = [
      { id: "net-1", kind: "ethernet", name: "LAN", visible: true },
    ];
    const attachments = [
      { interfaceId: "eth0", networkId: "net-1" },
      { interfaceId: "eth0-n2", networkId: "net-1" },
    ];
    const nodesWithIface = [
      {
        id: "n1",
        name: "R1",
        position: { x: 50, y: 50 },
        interfaces: [{ id: "eth0", name: "eth0", slot: 0 }],
      },
      {
        id: "n2",
        name: "R2",
        position: { x: 50, y: 250 },
        interfaces: [{ id: "eth0-n2", name: "eth0", slot: 0 }],
      },
    ];

    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={nodesWithIface}
        networks={networks}
        attachments={attachments}
      />,
    );

    const link = screen.getByTestId("link-net-1");
    expect(link).toHaveAttribute("y1", "136");
    expect(link).toHaveAttribute("y2", "242");
  });

  it("anchors horizontally dominant diagonal cables to the sides of nodes", () => {
    const networks = [
      { id: "net-1", kind: "ethernet", name: "LAN", visible: true },
    ];
    const attachments = [
      { interfaceId: "eth0", networkId: "net-1" },
      { interfaceId: "eth0-n2", networkId: "net-1" },
    ];
    const nodesWithIface = [
      {
        id: "n1",
        name: "R1",
        position: { x: 50, y: 50 },
        interfaces: [{ id: "eth0", name: "eth0", slot: 0 }],
      },
      {
        id: "n2",
        name: "R2",
        position: { x: 250, y: 80 },
        interfaces: [{ id: "eth0-n2", name: "eth0", slot: 0 }],
      },
    ];

    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={nodesWithIface}
        networks={networks}
        attachments={attachments}
      />,
    );

    const link = screen.getByTestId("link-net-1");
    expect(link).toHaveAttribute("x1", "132");
    expect(link).toHaveAttribute("y1", "74");
    expect(link).toHaveAttribute("x2", "268");
    expect(link).toHaveAttribute("y2", "104");
  });

  it("shows node status based on nodeStatuses", () => {
    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={nodes}
        nodeStatuses={{ n1: "running", n2: "stopped" }}
      />,
    );

    expect(screen.getByTestId("status-n1")).toHaveTextContent("running");
    expect(screen.getByTestId("status-n2")).toHaveTextContent("stopped");
    expect(Number(screen.getByTestId("status-n1").getAttribute("y"))).toBe(124);
  });

  it("shows default stopped status when no nodeStatuses", () => {
    render(<TopologyCanvas labName="Lab" labId="lab-1" nodes={nodes} />);

    expect(screen.getByTestId("status-n1")).toHaveTextContent("stopped");
    expect(screen.getByTestId("status-n2")).toHaveTextContent("stopped");
  });

  it("shows running status for nodes with desiredPower on", () => {
    const nodesWithState = [
      {
        id: "n1",
        name: "R1",
        position: { x: 50, y: 50 },
        state: { desiredPower: "on" as const },
      },
    ];

    render(
      <TopologyCanvas labName="Lab" labId="lab-1" nodes={nodesWithState} />,
    );

    expect(screen.getByTestId("status-n1")).toHaveTextContent("running");
  });

  it("renders firewall role glyphs instead of legacy node boxes", () => {
    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={[
          {
            id: "node-1",
            name: "Firewall-1",
            position: { x: 50, y: 50 },
            deviceRoleIcon: "firewall",
          },
        ]}
      />,
    );

    expect(
      screen.getByTestId("canvas-node-firewall-node-1"),
    ).toBeInTheDocument();
    const nodeGroup = screen.getByTestId("node-node-1");
    expect(
      nodeGroup.querySelector('rect[fill="var(--canvas-node-fill)"]'),
    ).toBeNull();
  });

  it("renders cloud icon for cloud nodes", () => {
    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={[
          {
            id: "n1",
            name: "Cloud-1",
            runtime: "cloud",
            position: { x: 50, y: 50 },
          },
        ]}
      />,
    );

    expect(screen.getByTestId("node-icon-n1")).toHaveAttribute(
      "data-icon-kind",
      "cloud",
    );
  });

  it("renders node glyphs without a backplate circle", () => {
    render(<TopologyCanvas labName="Lab" labId="lab-1" nodes={nodes} />);

    expect(
      screen.queryByTestId("node-glyph-backplate-n1"),
    ).not.toBeInTheDocument();
  });

  it("calls onSelectNode when a node is clicked", () => {
    const onSelectNode = vi.fn();
    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={nodes}
        onSelectNode={onSelectNode}
      />,
    );

    const nodeGroup = screen.getByTestId("node-n1");
    fireEvent.mouseDown(nodeGroup);

    expect(onSelectNode).toHaveBeenCalledWith("n1");
  });

  it("calls onOpenNativeConsole when a node is double-clicked", () => {
    const onOpenNativeConsole = vi.fn();
    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={nodes}
        onOpenNativeConsole={onOpenNativeConsole}
      />,
    );

    fireEvent.doubleClick(screen.getByTestId("node-n1"));

    expect(onOpenNativeConsole).toHaveBeenCalledWith("n1");
  });

  it("does not render interface ports under nodes", () => {
    const nodesWithIface = [
      {
        id: "n1",
        name: "R1",
        position: { x: 50, y: 50 },
        interfaces: [
          { id: "eth0", name: "eth0", slot: 0 },
          { id: "eth1", name: "eth1", slot: 1 },
        ],
      },
    ];

    render(
      <TopologyCanvas labName="Lab" labId="lab-1" nodes={nodesWithIface} />,
    );

    expect(screen.queryByTestId("port-eth0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("port-eth1")).not.toBeInTheDocument();
  });

  it("renders hub-and-spoke links for multi-node networks", () => {
    const nodes3 = [
      {
        id: "n1",
        name: "R1",
        position: { x: 50, y: 50 },
        interfaces: [{ id: "e1", name: "eth0", slot: 0 }],
      },
      {
        id: "n2",
        name: "R2",
        position: { x: 250, y: 50 },
        interfaces: [{ id: "e2", name: "eth0", slot: 0 }],
      },
      {
        id: "n3",
        name: "R3",
        position: { x: 150, y: 200 },
        interfaces: [{ id: "e3", name: "eth0", slot: 0 }],
      },
    ];
    const networks = [
      { id: "net-1", kind: "ethernet", name: "LAN", visible: true },
    ];
    const attachments = [
      { interfaceId: "e1", networkId: "net-1" },
      { interfaceId: "e2", networkId: "net-1" },
      { interfaceId: "e3", networkId: "net-1" },
    ];

    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={nodes3}
        networks={networks}
        attachments={attachments}
      />,
    );

    expect(screen.getByTestId("link-net-1-n1")).toBeInTheDocument();
    expect(screen.getByTestId("link-net-1-n2")).toBeInTheDocument();
    expect(screen.getByTestId("link-net-1-n3")).toBeInTheDocument();
    expect(screen.getByTestId("link-net-1-n1")).toHaveAttribute("x1", "132");
    expect(screen.getByTestId("link-net-1-n1")).toHaveAttribute("y1", "74");
    expect(screen.getByTestId("link-net-1-n2")).toHaveAttribute("x1", "268");
    expect(screen.getByTestId("link-net-1-n2")).toHaveAttribute("y1", "74");
    expect(screen.getByTestId("link-net-1-n3")).toHaveAttribute("y1", "192");
  });

  it("highlights selected node", () => {
    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={nodes}
        selectedNodeId="n1"
      />,
    );

    const body = screen.getByTestId("node-body-n1");
    expect(body).toHaveAttribute(
      "data-outline-color",
      "var(--canvas-node-selected)",
    );
    expect(body.getAttribute("style") ?? "").toContain("filter: none;");
  });

  it("keeps node labels clickable for selection", () => {
    const onSelectNode = vi.fn();
    render(
      <TopologyCanvas
        labName="Lab"
        labId="lab-1"
        nodes={nodes}
        onSelectNode={onSelectNode}
      />,
    );

    fireEvent.mouseDown(screen.getByText("Router-1"));

    expect(onSelectNode).toHaveBeenCalledWith("n1");
  });

  describe("drawings", () => {
    const shape = {
      id: "shape-1",
      kind: "shape" as const,
      shape: "rectangle" as const,
      x: 20,
      y: 30,
      width: 180,
      height: 90,
      fill: "#fde68a",
      stroke: "#f59e0b",
      opacity: 0.35,
      locked: false,
      zIndex: 1,
    };

    it("renders persistent shapes behind topology objects", () => {
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[shape]}
        />,
      );

      const drawing = screen.getByTestId("drawing-shape-1");
      expect(drawing).toHaveAttribute("fill", "#fde68a");
      expect(drawing).toHaveAttribute("opacity", "0.35");
    });

    it("adds a rectangle drawing with the selected fill color", () => {
      const onUpdateCanvasDrawings = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[]}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      fireEvent.change(screen.getByLabelText("Drawing Color"), {
        target: { value: "#bfdbfe" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add Rectangle" }));

      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        expect.objectContaining({
          kind: "shape",
          shape: "rectangle",
          fill: "#bfdbfe",
          opacity: 0.75,
        }),
      ]);
    });

    it("uses icon-only drawing tools in a bottom dock", () => {
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[]}
          onUpdateCanvasDrawings={vi.fn()}
        />,
      );

      const toolbar = screen.getByLabelText("Drawing Tools");
      expect(toolbar).toHaveClass("canvas-drawing-dock");
      expect(
        screen.getByRole("button", { name: "Add Rectangle" }),
      ).toHaveTextContent("");
    });

    it("adds a text drawing where the armed text tool is clicked", () => {
      const onUpdateCanvasDrawings = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[]}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      fireEvent.change(screen.getByLabelText("Drawing Color"), {
        target: { value: "#facc15" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Add Text" }));
      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);
      fireEvent.mouseDown(svg, { clientX: 260, clientY: 310 });

      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        expect.objectContaining({
          kind: "text",
          x: 260,
          y: 310,
          text: "Label",
          fill: "#facc15",
          fontSize: 22,
        }),
      ]);
    });

    it("renders persistent text drawings", () => {
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[
            {
              id: "text-1",
              kind: "text",
              x: 20,
              y: 30,
              width: 160,
              height: 48,
              text: "WAN",
              fill: "#facc15",
              fontSize: 22,
              opacity: 1,
              locked: false,
              zIndex: 2,
            },
          ]}
        />,
      );

      const drawing = screen.getByTestId("drawing-text-1");
      expect(drawing).toHaveTextContent("WAN");
      expect(drawing).toHaveAttribute("fill", "#facc15");
    });

    it("edits text drawings on double click", () => {
      const onUpdateCanvasDrawings = vi.fn();
      const textDrawing = {
        id: "text-1",
        kind: "text" as const,
        x: 20,
        y: 30,
        width: 160,
        height: 48,
        text: "WAN",
        fill: "#facc15",
        fontSize: 22,
        opacity: 1,
        locked: false,
        zIndex: 2,
      };
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[textDrawing]}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      fireEvent.doubleClick(screen.getByTestId("drawing-text-1"));
      const editor = screen.getByLabelText("Edit Text Drawing");
      const editFrame = editor.closest("foreignObject");
      expect(editFrame).not.toBeNull();
      expect(editFrame).toHaveAttribute("width", "160");
      expect(editor.closest(".canvas-inline-text-editor-frame")).not.toBeNull();
      expect(editor.closest(".canvas-inline-text-editor-frame")).toHaveStyle({
        height: "100%",
        width: "100%",
      });
      expect(editor).toHaveStyle({ height: "100%", width: "100%" });
      expect(editor).not.toHaveAttribute("size");
      expect(document.querySelector(".canvas-text-editor")).toBeNull();
      fireEvent.change(editor, { target: { value: "Internet" } });
      fireEvent.blur(editor);

      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        { ...textDrawing, text: "Internet" },
      ]);
    });

    it("moves unlocked drawings by dragging them", () => {
      const onMoveNodes = vi.fn();
      const onUpdateCanvasDrawings = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[shape]}
          onMoveNodes={onMoveNodes}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(screen.getByTestId("drawing-shape-1"), {
        clientX: 30,
        clientY: 40,
      });
      fireEvent.mouseMove(svg, { clientX: 90, clientY: 120 });

      expect(screen.getByTestId("node-hitbox-n1")).toHaveAttribute("x", "50");
      expect(screen.getByTestId("node-hitbox-n1")).toHaveAttribute("y", "50");

      fireEvent.mouseUp(svg);

      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        expect.objectContaining({ id: "shape-1", x: 80, y: 110 }),
      ]);
      expect(onMoveNodes).not.toHaveBeenCalled();
    });

    it("moves topology nodes inside a dragged locked drawing in one batch", async () => {
      const onMoveNode = vi.fn();
      const onMoveNodes = vi.fn();
      const onUpdateCanvasDrawings = vi.fn();
      const frame = {
        ...shape,
        locked: true,
        x: 20,
        y: 20,
        width: 420,
        height: 180,
      };
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[frame]}
          onMoveNode={onMoveNode}
          onMoveNodes={onMoveNodes}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(screen.getByTestId("drawing-shape-1"), {
        clientX: 30,
        clientY: 40,
      });
      fireEvent.mouseMove(svg, { clientX: 90, clientY: 120 });

      expect(screen.getByTestId("node-hitbox-n1")).toHaveAttribute("x", "110");
      expect(screen.getByTestId("node-hitbox-n1")).toHaveAttribute("y", "130");

      fireEvent.mouseUp(svg);

      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        expect.objectContaining({ id: "shape-1", x: 80, y: 100 }),
      ]);
      await waitFor(() => {
        expect(onMoveNode).not.toHaveBeenCalled();
        expect(onMoveNodes).toHaveBeenCalledWith([
          { nodeId: "n1", position: { x: 110, y: 130 } },
          { nodeId: "n2", position: { x: 310, y: 130 } },
        ]);
      });
    });

    it("keeps locked-frame node positions bound until the node move save completes", async () => {
      let resolveDrawingSave: (() => void) | undefined;
      let resolveNodeSave: (() => void) | undefined;
      const onUpdateCanvasDrawings = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDrawingSave = resolve;
          }),
      );
      const onMoveNodes = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveNodeSave = resolve;
          }),
      );
      const frame = {
        ...shape,
        locked: true,
        x: 20,
        y: 20,
        width: 420,
        height: 180,
      };
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[frame]}
          onMoveNodes={onMoveNodes}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(screen.getByTestId("drawing-shape-1"), {
        clientX: 30,
        clientY: 40,
      });
      fireEvent.mouseMove(svg, { clientX: 90, clientY: 120 });
      fireEvent.mouseUp(svg);

      expect(screen.getByTestId("node-hitbox-n1")).toHaveAttribute("x", "110");
      expect(onUpdateCanvasDrawings).toHaveBeenCalled();
      expect(onMoveNodes).not.toHaveBeenCalled();

      await act(async () => {
        resolveDrawingSave?.();
      });

      await waitFor(() => {
        expect(onMoveNodes).toHaveBeenCalledWith([
          { nodeId: "n1", position: { x: 110, y: 130 } },
          { nodeId: "n2", position: { x: 310, y: 130 } },
        ]);
      });
      expect(screen.getByTestId("node-hitbox-n1")).toHaveAttribute("x", "110");

      await act(async () => {
        resolveNodeSave?.();
      });
    });

    it("keeps locked-frame node positions visible when the node move save fails", async () => {
      const onUpdateCanvasDrawings = vi.fn();
      const onMoveNodes = vi.fn(async () => {
        throw new Error("blocked by preflight");
      });
      const frame = {
        ...shape,
        locked: true,
        x: 20,
        y: 20,
        width: 420,
        height: 180,
      };
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[frame]}
          onMoveNodes={onMoveNodes}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(screen.getByTestId("drawing-shape-1"), {
        clientX: 30,
        clientY: 40,
      });
      fireEvent.mouseMove(svg, { clientX: 90, clientY: 120 });
      fireEvent.mouseUp(svg);

      await waitFor(() => {
        expect(onMoveNodes).toHaveBeenCalled();
      });
      expect(screen.getByTestId("node-hitbox-n1")).toHaveAttribute("x", "110");
      expect(screen.getByTestId("node-hitbox-n1")).toHaveAttribute("y", "130");
    });

    it("leaves text drawings inside an unlocked dragged drawing in place", () => {
      const onUpdateCanvasDrawings = vi.fn();
      const frame = {
        ...shape,
        x: 20,
        y: 20,
        width: 420,
        height: 180,
      };
      const textDrawing = {
        id: "text-1",
        kind: "text" as const,
        x: 120,
        y: 130,
        width: 160,
        height: 48,
        text: "network",
        fill: "#1d4ed8",
        fontSize: 22,
        opacity: 1,
        locked: false,
        zIndex: 2,
      };
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[frame, textDrawing]}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(screen.getByTestId("drawing-shape-1"), {
        clientX: 30,
        clientY: 40,
      });
      fireEvent.mouseMove(svg, { clientX: 90, clientY: 120 });
      fireEvent.mouseUp(svg);

      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        expect.objectContaining({ id: "shape-1", x: 80, y: 100 }),
        expect.objectContaining({ id: "text-1", x: 120, y: 130 }),
      ]);
    });

    it("moves text drawings inside a locked dragged drawing with the drawing", () => {
      const onUpdateCanvasDrawings = vi.fn();
      const frame = {
        ...shape,
        locked: true,
        x: 20,
        y: 20,
        width: 420,
        height: 180,
      };
      const textDrawing = {
        id: "text-1",
        kind: "text" as const,
        x: 120,
        y: 130,
        width: 160,
        height: 48,
        text: "network",
        fill: "#1d4ed8",
        fontSize: 22,
        opacity: 1,
        locked: false,
        zIndex: 2,
      };
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[frame, textDrawing]}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(screen.getByTestId("drawing-shape-1"), {
        clientX: 30,
        clientY: 40,
      });
      fireEvent.mouseMove(svg, { clientX: 90, clientY: 120 });
      fireEvent.mouseUp(svg);

      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        expect.objectContaining({ id: "shape-1", x: 80, y: 100 }),
        expect.objectContaining({ id: "text-1", x: 180, y: 210 }),
      ]);
    });

    it("moves locked drawings as bound frames", () => {
      const onUpdateCanvasDrawings = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[{ ...shape, locked: true }]}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(screen.getByTestId("drawing-shape-1"), {
        clientX: 30,
        clientY: 40,
      });
      fireEvent.mouseMove(svg, { clientX: 90, clientY: 120 });
      fireEvent.mouseUp(svg);

      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        expect.objectContaining({ id: "shape-1", x: 80, y: 110 }),
      ]);
      expect(screen.queryByTestId("drawing-resize-shape-1")).toBeNull();
    });

    it("resizes drawings from the resize handle", () => {
      const onUpdateCanvasDrawings = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[shape]}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(screen.getByTestId("drawing-shape-1"), {
        clientX: 30,
        clientY: 40,
      });
      fireEvent.mouseUp(svg);

      fireEvent.mouseDown(screen.getByTestId("drawing-resize-shape-1"), {
        clientX: 200,
        clientY: 120,
      });
      fireEvent.mouseMove(svg, { clientX: 250, clientY: 160 });
      fireEvent.mouseUp(svg);

      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        expect.objectContaining({ id: "shape-1", width: 230, height: 130 }),
      ]);
    });

    it("resizes drawings from the top-left handle without moving nodes", () => {
      const onMoveNode = vi.fn();
      const onUpdateCanvasDrawings = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[shape]}
          onMoveNode={onMoveNode}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(screen.getByTestId("drawing-shape-1"), {
        clientX: 30,
        clientY: 40,
      });
      fireEvent.mouseUp(svg);

      const handle = screen.getByTestId("drawing-resize-nw-shape-1");
      const node = screen.getByTestId("node-n1");
      expect(
        node.compareDocumentPosition(handle) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      fireEvent.mouseDown(handle, { clientX: 20, clientY: 30 });
      fireEvent.mouseMove(svg, { clientX: 5, clientY: 10 });
      fireEvent.mouseUp(svg);

      expect(onMoveNode).not.toHaveBeenCalled();
      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "shape-1",
          x: 5,
          y: 10,
          width: 195,
          height: 110,
        }),
      ]);
    });

    it("can lock and reorder drawings from the context menu", () => {
      const onUpdateCanvasDrawings = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[
            shape,
            { ...shape, id: "shape-2", x: 60, y: 80, zIndex: 2 },
          ]}
          onUpdateCanvasDrawings={onUpdateCanvasDrawings}
        />,
      );

      fireEvent.contextMenu(screen.getByTestId("drawing-shape-1"), {
        clientX: 40,
        clientY: 50,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "Bring Forward" }));

      expect(onUpdateCanvasDrawings).toHaveBeenCalledWith([
        expect.objectContaining({ id: "shape-1", zIndex: 3 }),
        expect.objectContaining({ id: "shape-2", zIndex: 2 }),
      ]);
    });
  });

  describe("drag", () => {
    const nodesWithIface = [
      {
        id: "n1",
        name: "R1",
        position: { x: 50, y: 50 },
        interfaces: [{ id: "e1", name: "eth0", slot: 0 }],
      },
      {
        id: "n2",
        name: "R2",
        position: { x: 250, y: 50 },
        interfaces: [{ id: "e2", name: "eth0", slot: 0 }],
      },
    ];

    it("calls onMoveNode after dragging a node", () => {
      const onMoveNode = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithIface}
          onMoveNode={onMoveNode}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      const nodeGroup = screen.getByTestId("node-n1");
      fireEvent.mouseDown(nodeGroup, { clientX: 100, clientY: 75 });
      fireEvent.mouseMove(svg, { clientX: 200, clientY: 175 });
      fireEvent.mouseUp(svg);

      expect(onMoveNode).toHaveBeenCalledWith(
        "n1",
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      );
    });

    it("pans the canvas when dragging on empty canvas", () => {
      render(
        <TopologyCanvas labName="Lab" labId="lab-1" nodes={nodesWithIface} />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(svg, { clientX: 20, clientY: 20 });
      fireEvent.mouseMove(svg, { clientX: 220, clientY: 180 });

      expect(screen.getByTestId("viewport-layer")).toHaveAttribute(
        "transform",
        "translate(200 160) scale(1)",
      );
      expect(screen.queryByTestId("selection-box")).not.toBeInTheDocument();
    });

    it("selects nodes inside the selection box when using Shift+drag", () => {
      const onSelectNode = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithIface}
          onSelectNode={onSelectNode}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(svg, { clientX: 40, clientY: 40, shiftKey: true });
      fireEvent.mouseMove(svg, { clientX: 180, clientY: 140 });
      fireEvent.mouseUp(svg, { clientX: 180, clientY: 140 });

      expect(onSelectNode).toHaveBeenCalledWith("n1");
    });

    it("moves multiple selected nodes together when dragging one of them", () => {
      const onMoveNode = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithIface}
          onMoveNode={onMoveNode}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(svg, { clientX: 40, clientY: 40, shiftKey: true });
      fireEvent.mouseMove(svg, { clientX: 360, clientY: 140 });
      fireEvent.mouseUp(svg, { clientX: 360, clientY: 140 });

      fireEvent.mouseDown(screen.getByTestId("node-n1"), {
        clientX: 100,
        clientY: 75,
      });
      fireEvent.mouseMove(svg, { clientX: 200, clientY: 175 });
      fireEvent.mouseUp(svg);

      expect(onMoveNode).toHaveBeenCalledTimes(2);
      expect(onMoveNode).toHaveBeenCalledWith(
        "n1",
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      );
      expect(onMoveNode).toHaveBeenCalledWith(
        "n2",
        expect.objectContaining({
          x: expect.any(Number),
          y: expect.any(Number),
        }),
      );
    });

    it("pans the canvas with Space+drag without moving nodes", () => {
      const onMoveNode = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithIface}
          onMoveNode={onMoveNode}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.keyDown(svg, { key: " " });
      fireEvent.mouseDown(svg, { clientX: 20, clientY: 20 });
      fireEvent.mouseMove(svg, { clientX: 80, clientY: 60 });

      expect(screen.getByTestId("viewport-layer")).toHaveAttribute(
        "transform",
        "translate(60 40) scale(1)",
      );

      fireEvent.mouseUp(svg);
      fireEvent.keyUp(svg, { key: " " });

      expect(onMoveNode).not.toHaveBeenCalled();
    });

    it("zooms the canvas when the mouse wheel is used over the svg", () => {
      render(
        <TopologyCanvas labName="Lab" labId="lab-1" nodes={nodesWithIface} />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.wheel(svg, { deltaY: -100, clientX: 100, clientY: 75 });

      const transform = parseViewportTransform(
        screen.getByTestId("viewport-layer").getAttribute("transform"),
      );
      expect(transform).not.toBeNull();
      expect(transform?.scale).toBeCloseTo(1.1, 5);
      expect(transform?.x).toBeCloseTo(-10, 5);
      expect(transform?.y).toBeCloseTo(-7.5, 5);
    });

    it("starts oversized saved drawings centered at a sensible scale", async () => {
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodes}
          drawings={[
            {
              id: "large-frame",
              kind: "shape",
              shape: "rectangle",
              x: 0,
              y: 0,
              width: 1380,
              height: 860,
              fill: "#fde68a",
              stroke: "#f59e0b",
              opacity: 0.75,
              locked: true,
              zIndex: 1,
            },
          ]}
        />,
      );

      await waitFor(() => {
        const transform = parseViewportTransform(
          screen.getByTestId("viewport-layer").getAttribute("transform"),
        );
        expect(transform).not.toBeNull();
        expect(transform?.scale).toBeLessThan(1);
        expect(transform?.x).toBeGreaterThan(0);
        expect(transform?.y).toBeGreaterThan(0);
      });
    });

    it("keeps drag coordinates correct after zooming", () => {
      const onMoveNode = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithIface}
          onMoveNode={onMoveNode}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.wheel(svg, { deltaY: -100, clientX: 100, clientY: 75 });
      fireEvent.mouseDown(screen.getByTestId("node-n1"), {
        clientX: 100,
        clientY: 74,
      });
      fireEvent.mouseMove(svg, { clientX: 111, clientY: 85 });
      fireEvent.mouseUp(svg);

      expect(onMoveNode).toHaveBeenCalledWith(
        "n1",
        expect.objectContaining({
          x: expect.closeTo(60, 5),
          y: expect.closeTo(60, 5),
        }),
      );
    });
  });

  describe("cable drawing", () => {
    const nodesWithIface = [
      {
        id: "n1",
        name: "R1",
        position: { x: 50, y: 50 },
        interfaces: [{ id: "e1", name: "eth0", slot: 0 }],
      },
      {
        id: "n2",
        name: "R2",
        position: { x: 250, y: 50 },
        interfaces: [{ id: "e2", name: "eth0", slot: 0 }],
      },
    ];

    it("shows add cable in the node context menu", () => {
      render(
        <TopologyCanvas labName="Lab" labId="lab-1" nodes={nodesWithIface} />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);
      fireEvent.contextMenu(screen.getByTestId("node-n1"), {
        clientX: 100,
        clientY: 98,
      });

      expect(
        screen.getByRole("menuitem", { name: "Add Cable" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "Rename" }),
      ).toBeInTheDocument();
    });

    it("invokes rename from the node context menu", () => {
      const onRenameNode = vi.fn();
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithIface}
          onRenameNode={onRenameNode}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);
      fireEvent.contextMenu(screen.getByTestId("node-n1"), {
        clientX: 100,
        clientY: 98,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

      expect(onRenameNode).toHaveBeenCalledWith("n1");
    });

    it("closes the node context menu on a normal click elsewhere", () => {
      render(
        <TopologyCanvas labName="Lab" labId="lab-1" nodes={nodesWithIface} />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.contextMenu(screen.getByTestId("node-n1"), {
        clientX: 100,
        clientY: 98,
      });

      expect(
        screen.getByRole("menuitem", { name: "Add Cable" }),
      ).toBeInTheDocument();

      fireEvent.mouseDown(svg, { clientX: 20, clientY: 20 });

      expect(
        screen.queryByRole("menuitem", { name: "Add Cable" }),
      ).not.toBeInTheDocument();
    });

    it("starts cable drawing from a node context-menu action", () => {
      render(
        <TopologyCanvas labName="Lab" labId="lab-1" nodes={nodesWithIface} />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.contextMenu(screen.getByTestId("node-n1"), {
        clientX: 100,
        clientY: 98,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "Add Cable" }));

      expect(screen.getByTestId("rubber-band")).toBeInTheDocument();
    });

    it("opens a cable dialog when dropping on a different node", async () => {
      const onCreateNetwork = vi
        .fn()
        .mockResolvedValue({ network: { id: "net-new" } });
      const onAttachInterfaces = vi.fn().mockResolvedValue(undefined);
      const onRefreshLab = vi.fn();

      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithIface}
          onCreateNetwork={onCreateNetwork}
          onAttachInterfaces={onAttachInterfaces}
          onRefreshLab={onRefreshLab}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.contextMenu(screen.getByTestId("node-n1"), {
        clientX: 100,
        clientY: 98,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "Add Cable" }));

      expect(screen.getByTestId("rubber-band")).toBeInTheDocument();

      fireEvent.mouseUp(screen.getByTestId("node-n2"), {
        clientX: 300,
        clientY: 98,
      });

      expect(
        screen.getByRole("dialog", { name: "Add Cable" }),
      ).toBeInTheDocument();
    });

    it("only lists free interfaces when adding a cable", () => {
      const nodesWithPorts = [
        {
          id: "n1",
          name: "R1",
          position: { x: 50, y: 50 },
          interfaces: [
            { id: "e1", name: "eth0", slot: 0 },
            { id: "e1-free", name: "eth1", slot: 1 },
          ],
        },
        {
          id: "n2",
          name: "R2",
          position: { x: 250, y: 50 },
          interfaces: [
            { id: "e2", name: "eth0", slot: 0 },
            { id: "e2-free", name: "eth1", slot: 1 },
          ],
        },
      ];

      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithPorts}
          networks={[
            {
              id: "net-existing",
              kind: "ethernet",
              name: "LAN",
              visible: true,
            },
          ]}
          attachments={[
            { interfaceId: "e1", networkId: "net-existing" },
            { interfaceId: "e2", networkId: "net-existing" },
          ]}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.contextMenu(screen.getByTestId("node-n1"), {
        clientX: 100,
        clientY: 98,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "Add Cable" }));
      fireEvent.mouseUp(screen.getByTestId("node-n2"), {
        clientX: 300,
        clientY: 98,
      });

      const sourceSelect = screen.getByLabelText(
        "Source Interface",
      ) as HTMLSelectElement;
      const targetSelect = screen.getByLabelText(
        "Destination Interface",
      ) as HTMLSelectElement;

      expect(
        Array.from(sourceSelect.options).map((option) => option.value),
      ).toEqual(["e1-free"]);
      expect(
        Array.from(targetSelect.options).map((option) => option.value),
      ).toEqual(["e2-free"]);
      expect(sourceSelect.value).toBe("e1-free");
      expect(targetSelect.value).toBe("e2-free");
    });

    it("cancels cable drawing on Escape", () => {
      render(
        <TopologyCanvas labName="Lab" labId="lab-1" nodes={nodesWithIface} />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.contextMenu(screen.getByTestId("node-n1"), {
        clientX: 100,
        clientY: 98,
      });
      fireEvent.click(screen.getByRole("menuitem", { name: "Add Cable" }));

      expect(screen.getByTestId("rubber-band")).toBeInTheDocument();

      fireEvent.keyDown(svg, { key: "Escape" });

      expect(screen.queryByTestId("rubber-band")).not.toBeInTheDocument();
    });
  });

  describe("disconnect", () => {
    const nodesWithIface = [
      {
        id: "n1",
        name: "R1",
        position: { x: 50, y: 50 },
        interfaces: [{ id: "e1", name: "eth0", slot: 0 }],
      },
      {
        id: "n2",
        name: "R2",
        position: { x: 250, y: 50 },
        interfaces: [{ id: "e2", name: "eth0", slot: 0 }],
      },
    ];
    const networks = [
      { id: "net-1", kind: "ethernet", name: "LAN", visible: true },
    ];
    const attachments = [
      { interfaceId: "e1", networkId: "net-1" },
      { interfaceId: "e2", networkId: "net-1" },
    ];

    it("shows disconnect popup when clicking a link line", () => {
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithIface}
          networks={networks}
          attachments={attachments}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      const link = screen.getByTestId("link-net-1");
      fireEvent.mouseDown(link, { clientX: 200, clientY: 74 });

      expect(screen.getByTestId("disconnect-popup")).toBeInTheDocument();
    });

    it("calls onDetachInterface for all related interfaces when disconnecting a link", async () => {
      const onDetachInterface = vi.fn().mockResolvedValue(undefined);
      const onRefreshLab = vi.fn();

      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithIface}
          networks={networks}
          attachments={attachments}
          onDetachInterface={onDetachInterface}
          onRefreshLab={onRefreshLab}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      const link = screen.getByTestId("link-net-1");
      fireEvent.mouseDown(link, { clientX: 200, clientY: 74 });

      expect(screen.getByTestId("disconnect-popup")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Disconnect"));

      await waitFor(() => {
        expect(onDetachInterface).toHaveBeenCalledTimes(2);
      });
      expect(onDetachInterface).toHaveBeenCalledWith("lab-1", "e1");
      expect(onDetachInterface).toHaveBeenCalledWith("lab-1", "e2");
    });

    it("dismisses link disconnect popup on Cancel", () => {
      render(
        <TopologyCanvas
          labName="Lab"
          labId="lab-1"
          nodes={nodesWithIface}
          networks={networks}
          attachments={attachments}
        />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      const link = screen.getByTestId("link-net-1");
      fireEvent.mouseDown(link, { clientX: 200, clientY: 74 });

      expect(screen.getByTestId("disconnect-popup")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Cancel"));

      expect(screen.queryByTestId("disconnect-popup")).not.toBeInTheDocument();
    });
  });

  it("opens a cable context menu on right click", () => {
    const nodes = [
      {
        id: "node-a",
        name: "A",
        position: { x: 50, y: 50 },
        interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
      },
      {
        id: "node-b",
        name: "B",
        position: { x: 250, y: 50 },
        interfaces: [{ id: "if-b-0", name: "eth0", slot: 0 }],
      },
    ];

    render(
      <TopologyCanvas
        labName="Demo"
        labId="lab-1"
        nodes={nodes}
        networks={[
          { id: "net-1", kind: "ethernet", name: "link", visible: false },
        ]}
        attachments={[
          { interfaceId: "if-a-0", networkId: "net-1" },
          { interfaceId: "if-b-0", networkId: "net-1" },
        ]}
        onDeleteCable={vi.fn()}
      />,
    );

    const svg = screen.getByTestId("topology-svg");
    mockSvgPoint(svg);
    fireEvent.contextMenu(screen.getByTestId("link-net-1"), {
      clientX: 200,
      clientY: 100,
    });

    expect(
      screen.getByRole("menuitem", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });
});
