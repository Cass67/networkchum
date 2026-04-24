import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TemplatesTab } from "./TemplatesTab.js";

afterEach(() => {
  cleanup();
});

describe("TemplatesTab", () => {
  it("edits and saves hardware template defaults", async () => {
    const onSaveTemplate = vi.fn(async () => undefined);

    render(
      <TemplatesTab
        templates={[
          {
            id: "cisco-asr",
            name: "Cisco ASR",
            vendor: "Cisco",
            runtime: "qemu",
            deviceRoleIcon: "router",
            configSchema: {
              vcpu: { default: 4, min: 2, max: 8 },
              ramMb: { default: 8192, min: 4096, max: 16384 },
              interfaceCount: { default: 8, min: 4, max: 24 },
            },
          },
          {
            id: "alpine",
            name: "Alpine Container",
            vendor: "Linux",
            runtime: "container",
            deviceRoleIcon: "host",
            configSchema: {
              vcpu: { default: 1, min: 1, max: 4 },
              ramMb: { default: 256, min: 128, max: 1024 },
              interfaceCount: { default: 1, min: 1, max: 8 },
            },
          },
        ]}
        onSaveTemplate={onSaveTemplate}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Select Cisco ASR" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Select Alpine Container" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("vCPU"), {
      target: { value: "6" },
    });
    fireEvent.change(screen.getByLabelText("RAM (MB)"), {
      target: { value: "12288" },
    });
    fireEvent.change(screen.getByLabelText("Interfaces"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Role Icon"), {
      target: { value: "firewall" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Defaults" }));

    await waitFor(() => {
      expect(onSaveTemplate).toHaveBeenCalledWith("cisco-asr", {
        vcpu: 6,
        ramMb: 12288,
        interfaceCount: 12,
        deviceRoleIcon: "firewall",
      });
    });
  });
});
