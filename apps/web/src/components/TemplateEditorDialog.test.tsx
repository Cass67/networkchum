import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TemplateEditorDialog } from "./TemplateEditorDialog.js";

afterEach(() => {
  cleanup();
});

describe("TemplateEditorDialog", () => {
  it("shows Role Icon selector and submits the chosen deviceRoleIcon", async () => {
    const onSubmit = vi.fn(async () => {});

    render(
      <TemplateEditorDialog
        template={{
          id: "template-1",
          name: "Router Base",
          source: "built-in",
          vendor: "NetCorp",
          runtime: "qemu",
          deviceRoleIcon: "router",
          configSchema: {
            ramMb: { default: 2048, min: 512, max: 4096 },
            vcpu: { default: 2, min: 1, max: 4 },
            interfaceCount: { default: 4, min: 1, max: 16 },
          },
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const roleSelect = screen.getByLabelText("Role Icon");
    expect(roleSelect).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("option")
        .map((option) => option.getAttribute("value")),
    ).toEqual(["router", "switch", "firewall", "cloud", "host", "client"]);

    fireEvent.change(roleSelect, { target: { value: "firewall" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        vcpu: 2,
        ramMb: 2048,
        interfaceCount: 4,
        deviceRoleIcon: "firewall",
      });
    });
  });
});
