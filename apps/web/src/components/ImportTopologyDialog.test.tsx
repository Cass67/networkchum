import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImportTopologyDialog } from "./ImportTopologyDialog.js";

describe("ImportTopologyDialog", () => {
  afterEach(() => cleanup());

  it("previews an uploaded file and requires mappings before commit", async () => {
    const onPreview = vi.fn().mockResolvedValue({
      draftId: "draft-1",
      source: { format: "eve-unl", fileName: "demo.unl" },
      labName: "Demo",
      summary: { nodes: 1, networks: 0, links: 0 },
      issues: [],
      nodes: [
        {
          foreignId: "1",
          name: "R1",
          templateKey: "qemu:mystery:mystery",
          requestedTemplate: "mystery",
          requestedImage: "mystery",
          status: "unresolved",
          candidates: [{ templateId: "cisco-iosv", label: "Cisco IOSv" }],
        },
      ],
    });
    const onCommit = vi.fn();

    render(
      <ImportTopologyDialog
        open
        catalog={[
          {
            id: "cisco-iosv",
            name: "Cisco IOSv",
            source: "built-in",
            runtime: "qemu",
          },
        ]}
        images={[
          {
            id: "img-1",
            name: "iosv.qcow2",
            templateId: "cisco-iosv",
            source: "scan",
            catalogState: "active",
          },
        ]}
        onClose={vi.fn()}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Topology File"), {
      target: { files: [new File(["<lab />"], "demo.unl")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Import" }));

    expect(await screen.findByText("Demo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Lab" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.change(screen.getByLabelText("Substitute for R1"), {
      target: { value: "cisco-iosv" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Lab" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit.mock.calls[0][1].mappings[0]).toMatchObject({
      templateKey: "qemu:mystery:mystery",
      templateId: "cisco-iosv",
    });
  });

  it("can remove previewed nodes before creating the lab", async () => {
    const onPreview = vi.fn().mockResolvedValue({
      draftId: "draft-1",
      source: { format: "eve-unl", fileName: "demo.unl" },
      labName: "Demo",
      summary: { nodes: 2, networks: 0, links: 1 },
      issues: [],
      nodes: [
        {
          foreignId: "1",
          name: "R1",
          templateKey: "qemu:vios:vios",
          requestedTemplate: "vios",
          requestedImage: "vios",
          status: "matched",
          matchedTemplateId: "cisco-iosv",
          matchedImageId: "img-1",
          candidates: [],
        },
        {
          foreignId: "2",
          name: "R2",
          templateKey: "qemu:vios:vios",
          requestedTemplate: "vios",
          requestedImage: "vios",
          status: "matched",
          matchedTemplateId: "cisco-iosv",
          matchedImageId: "img-1",
          candidates: [],
        },
      ],
    });
    const onCommit = vi.fn();

    render(
      <ImportTopologyDialog
        open
        catalog={[
          {
            id: "cisco-iosv",
            name: "Cisco IOSv",
            source: "built-in",
            runtime: "qemu",
          },
        ]}
        images={[
          {
            id: "img-1",
            name: "iosv.qcow2",
            templateId: "cisco-iosv",
            source: "scan",
            catalogState: "active",
          },
        ]}
        onClose={vi.fn()}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Topology File"), {
      target: { files: [new File(["<lab />"], "demo.unl")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Import" }));

    expect(await screen.findByText("R1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove R2" }));

    expect(screen.queryByText("R2")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create Lab" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit.mock.calls[0][1].excludedNodeIds).toEqual(["2"]);
  });
});
