import { describe, expect, it } from "vitest";

import {
  ImportCommitRequestSchema,
  ImportPreviewSchema,
} from "./importTopology.js";

describe("import topology schemas", () => {
  it("accepts an import preview with unresolved mappings", () => {
    const preview = ImportPreviewSchema.parse({
      draftId: "draft-1",
      source: { format: "eve-unl", fileName: "lab.unl" },
      labName: "Imported Lab",
      summary: { nodes: 2, networks: 1, links: 1 },
      nodes: [
        {
          foreignId: "1",
          name: "R1",
          templateKey: "qemu:cisco-vios:vios-adventerprisek9",
          requestedTemplate: "vios",
          requestedImage: "vios-adventerprisek9",
          status: "unresolved",
          candidates: [{ templateId: "cisco-iosv", label: "Cisco IOSv" }],
        },
      ],
      issues: [{ severity: "warning", message: "Workbook ignored" }],
    });

    expect(preview.nodes[0]?.status).toBe("unresolved");
  });

  it("accepts commit mappings and excluded imported nodes", () => {
    const request = ImportCommitRequestSchema.parse({
      name: "Imported Lab",
      mappings: [
        {
          templateKey: "qemu:cisco-vios:vios-adventerprisek9",
          templateId: "cisco-iosv",
          imageId: "img-1",
        },
      ],
      excludedNodeIds: ["node-2"],
    });

    expect(request.mappings[0]?.imageId).toBe("img-1");
    expect(request.excludedNodeIds).toEqual(["node-2"]);
  });
});
