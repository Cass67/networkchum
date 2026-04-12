import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextMenu } from "./ContextMenu.js";

afterEach(() => {
  cleanup();
});

describe("ContextMenu", () => {
  it("renders menu items when open", () => {
    render(
      <ContextMenu
        open
        x={10}
        y={20}
        items={[{ label: "Disconnect", onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("menuitem", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });

  it("invokes the selected action", () => {
    const onSelect = vi.fn();
    render(
      <ContextMenu
        open
        x={10}
        y={20}
        items={[{ label: "Disconnect", onSelect }]}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Disconnect" }));
    expect(onSelect).toHaveBeenCalled();
  });
});
