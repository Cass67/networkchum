import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LabDetails } from "./LabDetails.js";

afterEach(() => {
  cleanup();
});

describe("LabDetails", () => {
  it("starts a staged lab power-on from the header", () => {
    const onPowerOnLab = vi.fn();
    render(
      <LabDetails
        labName="Lab"
        nodes={[{ id: "node-1", name: "veos-1" }]}
        onPowerOnLab={onPowerOnLab}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Power On Lab" }));
    expect(onPowerOnLab).toHaveBeenCalledTimes(1);
  });

  it("disables power on for nodes that are already running", () => {
    render(
      <LabDetails
        labName="Lab"
        nodes={[{ id: "node-1", name: "veos-1" }]}
        onPowerOnNode={vi.fn()}
        nodeStatuses={{ "node-1": "running" }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Power On veos-1" }),
    ).toBeDisabled();
  });

  it("shows and triggers copy native command for telnet-backed nodes", () => {
    const onCopyNativeCommand = vi.fn();

    render(
      <LabDetails
        labName="Lab"
        nodes={[{ id: "node-1", name: "veos-1" }]}
        nodeStatuses={{ "node-1": "running" }}
        nodeConnectCommands={{ "node-1": ["telnet", "127.0.0.1", "5004"] }}
        onCopyNativeCommand={onCopyNativeCommand}
        nativeConsoleModeLabel="Open in iTerm"
      />,
    );

    expect(screen.getByText("Console Port: 5004")).toBeInTheDocument();
    expect(
      screen.getByText("Double-click Action: Open in iTerm"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Copy Native Command" }),
    );
    expect(onCopyNativeCommand).toHaveBeenCalledWith("node-1");
  });

  it("disables open console when the serial port is already in use", () => {
    render(
      <LabDetails
        labName="Lab"
        nodes={[{ id: "node-1", name: "veos-1" }]}
        nodeStatuses={{ "node-1": "running" }}
        nodeMessages={{
          "node-1": "Serial console already in use by another client.",
        }}
        nodeConnectCommands={{ "node-1": ["telnet", "127.0.0.1", "5004"] }}
      />,
    );

    expect(screen.getByRole("button", { name: "Open Console" })).toBeDisabled();
  });

  it("shows console port status and disconnect action for the selected busy node", () => {
    render(
      <LabDetails
        labName="Lab"
        nodes={[{ id: "node-1", name: "veos-1" }]}
        nodeStatuses={{ "node-1": "running" }}
        nodeMessages={{
          "node-1": "Serial console already in use by another client.",
        }}
        nodeConnectCommands={{ "node-1": ["telnet", "127.0.0.1", "5004"] }}
        selectedNodeId="node-1"
      />,
    );

    expect(screen.getByText("Console Port: 5004")).toBeInTheDocument();
    expect(screen.getByText("Console Status: Busy")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Disconnect Native Console" }),
    ).toBeInTheDocument();
  });

  it("shows only the selected node when a node is focused", () => {
    render(
      <LabDetails
        labName="Lab"
        nodes={[
          { id: "node-1", name: "veos-1" },
          { id: "node-2", name: "veos-2" },
        ]}
        selectedNodeId="node-1"
      />,
    );

    expect(screen.getAllByText("veos-1").length).toBeGreaterThan(0);
    expect(screen.queryByText("veos-2")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Power On veos-2" }),
    ).not.toBeInTheDocument();
  });

  it("supports inline node rename from the device row", async () => {
    const onRenameNode = vi.fn(async () => undefined);

    render(
      <LabDetails
        labName="Lab"
        nodes={[{ id: "node-1", name: "veos-1" }]}
        onRenameNode={onRenameNode}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit Name veos-1" }));

    const input = screen.getByLabelText("Rename veos-1");
    fireEvent.change(input, { target: { value: "veos-edge-1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onRenameNode).toHaveBeenCalledWith("node-1", "veos-edge-1");
    });
  });
});
