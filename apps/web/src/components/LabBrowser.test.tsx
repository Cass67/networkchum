import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LabBrowser } from "./LabBrowser.js";

afterEach(() => {
  cleanup();
});

describe("LabBrowser", () => {
  it("renders labs", () => {
    render(<LabBrowser labs={[{ id: "lab-1", name: "Core Lab" }]} />);

    expect(
      screen.getByRole("button", { name: "Open Core Lab" }),
    ).toBeInTheDocument();
  });

  it("calls onSelectLab when a lab is clicked", () => {
    let selectedLabId = "";

    render(
      <LabBrowser
        labs={[{ id: "lab-1", name: "Core Lab" }]}
        onSelectLab={(labId) => {
          selectedLabId = labId;
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Core Lab" }));

    expect(selectedLabId).toBe("lab-1");
  });

  it("calls onContextMenuLab when a lab is right clicked", () => {
    const onContextMenuLab = vi.fn();

    render(
      <LabBrowser
        labs={[{ id: "lab-1", name: "Core Lab" }]}
        onContextMenuLab={onContextMenuLab}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Open Core Lab" }),
      {
        clientX: 30,
        clientY: 40,
      },
    );

    expect(onContextMenuLab).toHaveBeenCalledWith(
      "lab-1",
      expect.objectContaining({ x: 30, y: 40 }),
    );
  });

  it("supports backup actions from the lab context menu callback", () => {
    const onContextMenuLab = vi.fn();

    render(
      <LabBrowser
        labs={[{ id: "lab-1", name: "Core Lab" }]}
        onContextMenuLab={onContextMenuLab}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Open Core Lab" }),
      {
        clientX: 12,
        clientY: 18,
      },
    );

    expect(onContextMenuLab).toHaveBeenCalledWith(
      "lab-1",
      expect.objectContaining({ x: 12, y: 18 }),
    );
  });
});
