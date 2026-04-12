import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CableTool } from "./CableTool.js";

afterEach(() => {
  cleanup();
});

const interfaces = [
  {
    id: "eth0-n1",
    name: "eth0",
    nodeId: "n1",
    nodeName: "Router-1",
    networkId: null,
  },
  {
    id: "eth1-n1",
    name: "eth1",
    nodeId: "n1",
    nodeName: "Router-1",
    networkId: null,
  },
  {
    id: "eth0-n2",
    name: "eth0",
    nodeId: "n2",
    nodeName: "Router-2",
    networkId: null,
  },
];

describe("CableTool", () => {
  it("renders cable tool button in idle state", () => {
    render(
      <CableTool
        interfaces={interfaces}
        labId="lab-1"
        onCreateNetwork={vi.fn()}
        onAttachInterfaces={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByTestId("cable-tool-connect-btn")).toBeInTheDocument();
  });

  it("shows source interface selection after clicking connect", () => {
    render(
      <CableTool
        interfaces={interfaces}
        labId="lab-1"
        onCreateNetwork={vi.fn()}
        onAttachInterfaces={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("cable-tool-connect-btn"));

    expect(screen.getByText("Select source interface:")).toBeInTheDocument();
    expect(screen.getByTestId("source-eth0-n1")).toBeInTheDocument();
    expect(screen.getByTestId("source-eth0-n2")).toBeInTheDocument();
  });

  it("shows target interfaces after selecting source", () => {
    render(
      <CableTool
        interfaces={interfaces}
        labId="lab-1"
        onCreateNetwork={vi.fn()}
        onAttachInterfaces={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("cable-tool-connect-btn"));
    fireEvent.click(screen.getByTestId("source-eth0-n1"));

    expect(screen.getByText(/Source:/)).toBeInTheDocument();
    expect(screen.getByText("Select target interface:")).toBeInTheDocument();
    expect(screen.getByTestId("target-eth0-n2")).toBeInTheDocument();
  });

  it("excludes same-node interfaces from target list", () => {
    render(
      <CableTool
        interfaces={interfaces}
        labId="lab-1"
        onCreateNetwork={vi.fn()}
        onAttachInterfaces={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("cable-tool-connect-btn"));
    fireEvent.click(screen.getByTestId("source-eth0-n1"));

    expect(screen.queryByTestId("target-eth1-n1")).not.toBeInTheDocument();
  });

  it("creates connection when target is selected", async () => {
    const onCreateNetwork = vi
      .fn()
      .mockResolvedValue({ network: { id: "net-new" } });
    const onAttachInterfaces = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn();

    render(
      <CableTool
        interfaces={interfaces}
        labId="lab-1"
        onCreateNetwork={onCreateNetwork}
        onAttachInterfaces={onAttachInterfaces}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByTestId("cable-tool-connect-btn"));
    fireEvent.click(screen.getByTestId("source-eth0-n1"));
    fireEvent.click(screen.getByTestId("target-eth0-n2"));

    await waitFor(() => {
      expect(onCreateNetwork).toHaveBeenCalledWith("lab-1", {
        name: "link-Router-1-Router-2",
        visible: true,
      });
    });

    expect(onAttachInterfaces).toHaveBeenCalledWith("lab-1", {
      networkId: "net-new",
      interfaceIds: ["eth0-n1", "eth0-n2"],
    });

    expect(onRefresh).toHaveBeenCalled();
  });

  it("returns to idle on cancel", () => {
    render(
      <CableTool
        interfaces={interfaces}
        labId="lab-1"
        onCreateNetwork={vi.fn()}
        onAttachInterfaces={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("cable-tool-connect-btn"));
    fireEvent.click(screen.getByTestId("cable-tool-cancel"));

    expect(screen.getByTestId("cable-tool-connect-btn")).toBeInTheDocument();
  });

  it("shows error when connection fails", async () => {
    const onCreateNetwork = vi.fn().mockRejectedValue(new Error("fail"));

    render(
      <CableTool
        interfaces={interfaces}
        labId="lab-1"
        onCreateNetwork={onCreateNetwork}
        onAttachInterfaces={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("cable-tool-connect-btn"));
    fireEvent.click(screen.getByTestId("source-eth0-n1"));
    fireEvent.click(screen.getByTestId("target-eth0-n2"));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to create connection"),
      ).toBeInTheDocument();
    });
  });

  it("shows no available interfaces message when all are connected", () => {
    const connectedInterfaces = [
      {
        id: "eth0-n1",
        name: "eth0",
        nodeId: "n1",
        nodeName: "R1",
        networkId: "net-1",
      },
    ];

    render(
      <CableTool
        interfaces={connectedInterfaces}
        labId="lab-1"
        onCreateNetwork={vi.fn()}
        onAttachInterfaces={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("cable-tool-connect-btn"));

    expect(screen.getByText("No available interfaces")).toBeInTheDocument();
  });

  it("does nothing when labId is null", async () => {
    const onCreateNetwork = vi.fn();
    const onAttachInterfaces = vi.fn();

    render(
      <CableTool
        interfaces={interfaces}
        labId={null}
        onCreateNetwork={onCreateNetwork}
        onAttachInterfaces={onAttachInterfaces}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("cable-tool-connect-btn"));
    fireEvent.click(screen.getByTestId("source-eth0-n1"));
    fireEvent.click(screen.getByTestId("target-eth0-n2"));

    expect(onCreateNetwork).not.toHaveBeenCalled();
  });
});
