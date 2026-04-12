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
