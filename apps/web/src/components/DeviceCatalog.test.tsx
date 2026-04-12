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
            id: "linux-generic-vm",
            name: "Linux Generic VM",
            source: "built-in",
            configSchema: {
              ramMb: { default: 2048, min: 1024, max: 16384 },
              vcpu: { default: 2, min: 1, max: 8 },
              interfaceCount: { default: 2, min: 1, max: 16 },
            },
          },
        ]}
        onEditTemplate={onEditTemplate}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Edit Linux Generic VM" }),
    );
    expect(onEditTemplate).toHaveBeenCalledWith("linux-generic-vm");
  });
});
