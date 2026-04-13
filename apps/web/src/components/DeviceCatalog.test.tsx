import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeviceCatalog } from "./DeviceCatalog.js";

afterEach(() => {
  cleanup();
});

describe("DeviceCatalog", () => {
  it("renders device entries", () => {
    render(
      <DeviceCatalog
        entries={[
          { id: "cisco-asr", name: "Cisco ASR", source: "image-bound" },
          {
            id: "linux-alpine-container",
            name: "Alpine Container",
            source: "built-in",
          },
        ]}
      />,
    );

    expect(screen.getByText("Cisco ASR")).toBeInTheDocument();
    expect(screen.getByText("Alpine Container")).toBeInTheDocument();
  });

  it("renders Add buttons when onSelectTemplate is provided", () => {
    render(
      <DeviceCatalog
        entries={[
          { id: "cisco-asr", name: "Cisco ASR", source: "image-bound" },
        ]}
        onSelectTemplate={vi.fn()}
      />,
    );

    expect(
      screen.getByTestId("add-from-catalog-cisco-asr"),
    ).toBeInTheDocument();
  });

  it("does not render Add buttons when onSelectTemplate is not provided", () => {
    render(
      <DeviceCatalog
        entries={[
          { id: "cisco-asr", name: "Cisco ASR", source: "image-bound" },
        ]}
      />,
    );

    expect(
      screen.queryByTestId("add-from-catalog-cisco-asr"),
    ).not.toBeInTheDocument();
  });

  it("calls onSelectTemplate when Add is clicked", () => {
    const onSelectTemplate = vi.fn();
    render(
      <DeviceCatalog
        entries={[
          { id: "cisco-asr", name: "Cisco ASR", source: "image-bound" },
        ]}
        onSelectTemplate={onSelectTemplate}
      />,
    );

    fireEvent.click(screen.getByTestId("add-from-catalog-cisco-asr"));
    expect(onSelectTemplate).toHaveBeenCalledWith("cisco-asr");
  });

  it("calls onEditTemplate when Edit is clicked", () => {
    const onEditTemplate = vi.fn();
    render(
      <DeviceCatalog
        entries={[
          {
            id: "cisco-vios",
            name: "Cisco vIOS Router",
            source: "built-in",
            configSchema: {
              ramMb: { default: 1024, min: 512, max: 4096 },
              vcpu: { default: 1, min: 1, max: 4 },
              interfaceCount: { default: 4, min: 1, max: 16 },
            },
          },
        ]}
        onEditTemplate={onEditTemplate}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit Cisco vIOS Router" }),
    );
    expect(onEditTemplate).toHaveBeenCalledWith("cisco-vios");
  });

  it("renders cloud runtime label and hides zero compute details", () => {
    render(
      <DeviceCatalog
        entries={[
          {
            id: "cloud",
            name: "Cloud (External Network)",
            source: "built-in",
            vendor: "NetworkChum",
            runtime: "cloud",
            configSchema: {
              ramMb: { default: 0, min: 0, max: 0 },
              vcpu: { default: 0, min: 0, max: 0 },
              interfaceCount: { default: 10, min: 1, max: 24 },
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("NetworkChum • Cloud")).toBeInTheDocument();
    expect(screen.getByTestId("device-icon-cloud")).toBeInTheDocument();
    expect(screen.getByText("10 interfaces")).toBeInTheDocument();
    expect(screen.queryByText(/0 vCPU/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 MB RAM/)).not.toBeInTheDocument();
  });

  it("renders firewall role icon for qemu runtime templates", () => {
    render(
      <DeviceCatalog
        entries={[
          {
            id: "fortigate-firewall",
            name: "Fortigate Firewall",
            source: "built-in",
            runtime: "qemu",
            deviceRoleIcon: "firewall",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("device-role-icon-firewall")).toBeInTheDocument();
    expect(screen.queryByTestId("device-icon-vm")).not.toBeInTheDocument();
  });

  it("falls back to runtime icon when device role icon is invalid", () => {
    render(
      <DeviceCatalog
        entries={[
          {
            id: "unknown-role",
            name: "Unknown Role",
            source: "built-in",
            runtime: "qemu",
            deviceRoleIcon:
              "unknown" as unknown as import("../icons/deviceRoleIcons.js").DeviceRoleIcon,
          },
        ]}
      />,
    );

    expect(screen.getByTestId("device-icon-vm")).toBeInTheDocument();
    expect(screen.queryByTestId(/device-role-icon/i)).not.toBeInTheDocument();
  });
});
