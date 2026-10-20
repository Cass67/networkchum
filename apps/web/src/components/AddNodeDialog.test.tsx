import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddNodeDialog, computeNextPosition } from "./AddNodeDialog.js";

afterEach(() => {
  cleanup();
});

describe("AddNodeDialog", () => {
  const templates = [
    {
      id: "linux-alpine-container",
      name: "Alpine Container",
      source: "built-in",
      runtime: "container",
      configSchema: {
        interfaceCount: { default: 1, min: 1, max: 1 },
      },
    },
    {
      id: "cisco-asr",
      name: "Cisco ASR",
      source: "image-bound",
      runtime: "qemu",
      vendor: "Cisco",
      configSchema: {
        interfaceCount: { default: 8, min: 4, max: 24 },
      },
    },
    {
      id: "cloud",
      name: "Cloud (External Network)",
      source: "built-in",
      runtime: "cloud",
      configSchema: {
        interfaceCount: { default: 10, min: 1, max: 24 },
      },
    },
  ];

  it("renders the dialog with a searchable device list and name input", () => {
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("device-search")).toBeInTheDocument();
    expect(screen.getByTestId("device-option-cisco-asr")).toBeInTheDocument();
    expect(screen.getByTestId("node-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("add-node-submit")).toBeInTheDocument();
  });

  it("groups devices by vendor", () => {
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Cisco")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("filters devices by search text", () => {
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("device-search"), {
      target: { value: "cisco" },
    });

    expect(screen.getByTestId("device-option-cisco-asr")).toBeInTheDocument();
    expect(
      screen.queryByTestId("device-option-linux-alpine-container"),
    ).not.toBeInTheDocument();
  });

  it("shows a no-match row when search has no hits", () => {
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId("device-search"), {
      target: { value: "nonexistent" },
    });

    expect(screen.getByText("No matching devices")).toBeInTheDocument();
  });

  it("calls onCancel when cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onSubmit with the initially selected template", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("add-node-submit"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    const call = onSubmit.mock.calls[0]![0];
    expect(call.templateId).toBe("linux-alpine-container");
    expect(call.name).toBeTruthy();
    expect(call.position).toEqual({ x: 40, y: 40 });
  });

  it("shows error on submit failure", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("fail"));
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("add-node-submit"));

    await waitFor(() => {
      expect(screen.getByText("Failed to add node")).toBeInTheDocument();
    });
  });

  it("disables submit when name is empty", () => {
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const nameInput = screen.getByTestId("node-name-input");
    fireEvent.change(nameInput, { target: { value: "" } });
    expect(screen.getByTestId("add-node-submit")).toBeDisabled();
  });

  it("updates name when the device selection changes", () => {
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("device-option-cisco-asr"));

    const nameInput = screen.getByTestId("node-name-input") as HTMLInputElement;
    expect(nameInput.value).toContain("Cisco");
  });

  it("submits chosen interface count for templates with variable ports", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("device-option-cloud"));
    fireEvent.change(screen.getByTestId("interface-count-input"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByTestId("add-node-submit"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      templateId: "cloud",
      interfaceCount: 12,
    });
  });

  it("shows cloud role and bridge group inputs for cloud templates and submits them", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("device-option-cloud"));

    expect(screen.getByLabelText("Cloud Role")).toBeInTheDocument();
    expect(screen.getByLabelText("Bridge Group")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Cloud Role"), {
      target: { value: "private-circuit" },
    });
    fireEvent.change(screen.getByLabelText("Bridge Group"), {
      target: { value: "mpls-core" },
    });
    fireEvent.click(screen.getByTestId("add-node-submit"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      templateId: "cloud",
      cloudRole: "private-circuit",
      bridgeGroup: "mpls-core",
    });
  });

  it("shows macOS management subnet guidance when creating a management cloud", () => {
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        cloudManagementCapabilities={{
          platform: "macos",
          managementCloudMode: "macos-host-only",
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("device-option-cloud"));

    expect(screen.getByText(/172\.31\.255\.0\/24/)).toBeInTheDocument();
    expect(screen.getByText(/172\.31\.255\.1/)).toBeInTheDocument();
  });

  it("omits imageId for devices with a single bound image", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <AddNodeDialog
        templates={templates}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("device-option-cisco-asr"));
    fireEvent.click(screen.getByTestId("add-node-submit"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      templateId: "cisco-asr",
    });
    expect(onSubmit.mock.calls[0]?.[0].imageId).toBeUndefined();
  });

  it("lets the user pick an image when a device has several bound images", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const multiImage = [
      {
        id: "cisco-asr",
        name: "Cisco ASR",
        source: "image-bound",
        runtime: "qemu",
        vendor: "Cisco",
        imageId: "img-1",
        imageName: "asr-1.qcow2",
        configSchema: {
          interfaceCount: { default: 8, min: 4, max: 24 },
        },
      },
      {
        id: "cisco-asr",
        name: "Cisco ASR",
        source: "image-bound",
        runtime: "qemu",
        vendor: "Cisco",
        imageId: "img-2",
        imageName: "asr-2.qcow2",
        configSchema: {
          interfaceCount: { default: 8, min: 4, max: 24 },
        },
      },
    ];

    render(
      <AddNodeDialog
        templates={multiImage}
        existingNodes={[]}
        hostInterfaces={[]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId("device-option-cisco-asr"));
    const chooser = screen.getByLabelText("Image for Cisco ASR");
    fireEvent.change(chooser, { target: { value: "img-2" } });
    fireEvent.click(screen.getByTestId("add-node-submit"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      templateId: "cisco-asr",
      imageId: "img-2",
    });
  });
});

describe("computeNextPosition", () => {
  it("returns default position for no existing nodes", () => {
    const pos = computeNextPosition([]);
    expect(pos).toEqual({ x: 40, y: 40 });
  });

  it("returns next grid position when one node exists", () => {
    const pos = computeNextPosition([
      { id: "n1", name: "a", position: { x: 40, y: 40 } },
    ]);
    expect(pos.x).toBe(160);
    expect(pos.y).toBe(40);
  });

  it("wraps to next row when row is full", () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`,
      name: `node-${i}`,
      position: { x: 40 + i * 120, y: 40 },
    }));
    const pos = computeNextPosition(nodes);
    expect(pos.x).toBe(40);
    expect(pos.y).toBe(160);
  });
});
