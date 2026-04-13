import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectionPanel } from "./SelectionPanel.js";

afterEach(() => {
  cleanup();
});

describe("SelectionPanel", () => {
  it("shows delete and power actions for a selected node", () => {
    render(
      <SelectionPanel
        selected={{
          type: "node",
          node: { id: "node-1", name: "R1" },
          status: "running",
        }}
        onDeleteNode={vi.fn()}
        onPowerOnNode={vi.fn()}
        onPowerOffNode={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Delete Node" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Power Off" }),
    ).toBeInTheDocument();
  });

  it("calls delete when the delete node action is clicked", () => {
    const onDeleteNode = vi.fn();

    render(
      <SelectionPanel
        selected={{
          type: "node",
          node: { id: "node-1", name: "R1" },
          status: "stopped",
        }}
        onDeleteNode={onDeleteNode}
        onPowerOnNode={vi.fn()}
        onPowerOffNode={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Node" }));
    expect(onDeleteNode).toHaveBeenCalledWith("node-1");
  });

  it("shows the telnet port for a selected telnet-backed node", () => {
    render(
      <SelectionPanel
        selected={{
          type: "node",
          node: { id: "node-1", name: "R1" },
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
        }}
        onDeleteNode={vi.fn()}
        onPowerOnNode={vi.fn()}
        onPowerOffNode={vi.fn()}
      />,
    );

    expect(screen.getByText("Telnet Port: 5004")).toBeInTheDocument();
  });

  it("does not show interface cable controls in the inspector", () => {
    render(
      <SelectionPanel
        selected={{
          type: "node",
          node: {
            id: "node-1",
            name: "Cloud-1",
            runtime: "qemu",
            interfaces: [
              { id: "if-1", name: "eth0" },
              { id: "if-2", name: "eth1" },
            ],
          },
          status: "stopped",
        }}
        onDeleteNode={vi.fn()}
        onPowerOnNode={vi.fn()}
        onPowerOffNode={vi.fn()}
      />,
    );

    expect(screen.queryByText("Interfaces")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Connect / }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Disconnect / }),
    ).not.toBeInTheDocument();
  });

  it("shows a cloud settings action for cloud nodes", () => {
    const onEditCloudSettings = vi.fn();

    render(
      <SelectionPanel
        selected={{
          type: "node",
          node: {
            id: "cloud-1",
            name: "Cloud-1",
            runtime: "cloud",
          },
          status: "stopped",
        }}
        onEditCloudSettings={onEditCloudSettings}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cloud Settings" }));

    expect(onEditCloudSettings).toHaveBeenCalledWith("cloud-1");
    expect(
      screen.queryByRole("button", { name: "Startup Config" }),
    ).not.toBeInTheDocument();
  });

  it("shows effective container runtime details for a selected container node", () => {
    render(
      <SelectionPanel
        selected={{
          type: "node",
          node: {
            id: "container-1",
            name: "Oracle Linux",
            runtime: "container",
            effectiveContainer: {
              imageRef: "oraclelinux:10-slim",
              registry: "docker-hub",
              engine: "docker",
              shell: "bash",
            },
          },
          status: "stopped",
        }}
      />,
    );

    expect(screen.getByText("Image: oraclelinux:10-slim")).toBeInTheDocument();
    expect(screen.getByText("Registry: docker-hub")).toBeInTheDocument();
    expect(screen.getByText("Runtime: docker")).toBeInTheDocument();
    expect(screen.getByText("Shell: bash")).toBeInTheDocument();
  });

  it("shows macOS management subnet guidance for a selected management cloud", () => {
    render(
      <SelectionPanel
        selected={{
          type: "node",
          node: {
            id: "cloud-1",
            name: "Cloud-1",
            runtime: "cloud",
            config: { cloudRole: "management", bridgeGroup: "management" },
          },
          status: "stopped",
        }}
        cloudManagementCapabilities={{
          platform: "macos",
          managementCloudMode: "macos-host-only",
        }}
      />,
    );

    expect(screen.getByText(/172\.31\.255\.0\/24/)).toBeInTheDocument();
    expect(screen.getByText(/172\.31\.255\.1/)).toBeInTheDocument();
  });

  it("shows the auto backup checkbox for a selected lab", () => {
    render(
      <SelectionPanel
        selected={{
          type: "lab",
          lab: { id: "lab-1", name: "Core Lab", autoBackup: true },
        }}
        onRenameLab={vi.fn()}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "Auto Backup" })).toBeChecked();
  });
});
