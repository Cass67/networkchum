import type { ImageRecord, Template } from "@networkchum/shared";
import { describe, expect, it } from "vitest";

import { buildImportPreview } from "./deviceMatcher.js";
import type { NormalizedImportedTopology } from "./types.js";

const templates: Template[] = [
  {
    id: "cisco-iosv",
    runtime: "qemu",
    displayName: "Cisco IOSv",
    vendor: "Cisco",
    deviceRoleIcon: "router",
    boot: { console: "serial", acceleration: "hardware" },
    configSchema: {
      ramMb: { default: 512, min: 256, max: 2048 },
      vcpu: { default: 1, min: 1, max: 2 },
      interfaceCount: { default: 4, min: 1, max: 16 },
    },
  },
  {
    id: "arista-veos",
    runtime: "qemu",
    displayName: "Arista vEOS",
    vendor: "Arista",
    deviceRoleIcon: "switch",
    boot: { console: "serial", acceleration: "hardware" },
    configSchema: {
      ramMb: { default: 4096, min: 1024, max: 8192 },
      vcpu: { default: 1, min: 1, max: 4 },
      interfaceCount: { default: 4, min: 1, max: 16 },
    },
  },
];

const images: ImageRecord[] = [
  {
    id: "img-iosv",
    name: "vios-adventerprisek9.qcow2",
    path: "/images/vios.qcow2",
    format: "qcow2",
    sizeBytes: 1,
    updatedAt: "2026-04-24T00:00:00.000Z",
    templateId: "cisco-iosv",
    source: "scan",
    catalogState: "active",
  },
];

const topology: NormalizedImportedTopology = {
  source: { format: "eve-unl", fileName: "demo.unl", topologyPath: "demo.unl" },
  name: "demo",
  issues: [],
  links: [],
  nodes: [
    {
      foreignId: "1",
      name: "R1",
      templateName: "vios",
      imageName: "vios-adventerprisek9",
      runtimeHint: "qemu",
      position: { x: 10, y: 10 },
      interfaceNames: ["Gi0/0"],
    },
    {
      foreignId: "2",
      name: "SW1",
      templateName: "mystery-switch",
      imageName: "mystery.qcow2",
      runtimeHint: "qemu",
      position: { x: 100, y: 10 },
      interfaceNames: ["eth0"],
    },
  ],
};

describe("buildImportPreview", () => {
  it("matches known devices and reports substitute candidates for unknowns", () => {
    const preview = buildImportPreview({
      draftId: "draft-1",
      topology,
      templates,
      images,
    });

    expect(preview.nodes[0]).toMatchObject({
      status: "matched",
      matchedTemplateId: "cisco-iosv",
      matchedImageId: "img-iosv",
    });
    expect(preview.nodes[1]).toMatchObject({ status: "unresolved" });
    expect(
      preview.nodes[1]?.candidates.map((candidate) => candidate.templateId),
    ).toContain("arista-veos");
  });
});
