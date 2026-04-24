import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImportTopologyDialog } from "./ImportTopologyDialog.js";

describe("ImportTopologyDialog", () => {
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
    expect(screen.getByRole("button", { name: "Import Lab" })).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.change(screen.getByLabelText("Substitute for R1"), {
      target: { value: "cisco-iosv" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import Lab" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit.mock.calls[0][1].mappings[0]).toMatchObject({
      templateKey: "qemu:mystery:mystery",
      templateId: "cisco-iosv",
    });
  });
});
