import "@testing-library/jest-dom/vitest";
import {
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
    expect(screen.getByTestId("status-n1")).toHaveAttribute("y", "92");
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

    const nodeGroup = screen.getByTestId("node-n1");
    const rect = nodeGroup.querySelector("rect");
    expect(rect?.getAttribute("stroke")).toBe("var(--canvas-node-selected)");
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

    it("draws a selection box when dragging on empty canvas", () => {
      render(
        <TopologyCanvas labName="Lab" labId="lab-1" nodes={nodesWithIface} />,
      );

      const svg = screen.getByTestId("topology-svg");
      mockSvgPoint(svg);

      fireEvent.mouseDown(svg, { clientX: 20, clientY: 20 });
      fireEvent.mouseMove(svg, { clientX: 220, clientY: 180 });

      expect(screen.getByTestId("selection-box")).toBeInTheDocument();
    });

    it("selects nodes inside the selection box", () => {
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

      fireEvent.mouseDown(svg, { clientX: 40, clientY: 40 });
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

      fireEvent.mouseDown(svg, { clientX: 40, clientY: 40 });
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
        "translate(60 40)",
      );

      fireEvent.mouseUp(svg);
      fireEvent.keyUp(svg, { key: " " });

      expect(onMoveNode).not.toHaveBeenCalled();
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
