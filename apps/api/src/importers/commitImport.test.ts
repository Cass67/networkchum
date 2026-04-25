import type { Template } from "@networkchum/shared";
import { describe, expect, it } from "vitest";

import { buildLabDocumentFromImport } from "./commitImport.js";
import type { NormalizedImportedTopology } from "./types.js";

const template: Template = {
  id: "cisco-iosv",
  runtime: "qemu",
  displayName: "Cisco IOSv",
  vendor: "Cisco",
  deviceRoleIcon: "router",
  boot: { console: "serial", acceleration: "hardware", nicModel: "e1000" },
  configSchema: {
    ramMb: { default: 512, min: 256, max: 2048 },
    vcpu: { default: 1, min: 1, max: 2 },
    interfaceCount: { default: 4, min: 1, max: 16 },
  },
};

const topology: NormalizedImportedTopology = {
  source: { format: "eve-unl", fileName: "demo.unl", topologyPath: "demo.unl" },
  name: "demo",
  issues: [],
  nodes: [
    {
      foreignId: "1",
      name: "R1",
      templateName: "vios",
      imageName: "vios",
      runtimeHint: "qemu",
      position: { x: 10, y: 20 },
      interfaceNames: ["Gi0/0"],
      startupConfig: "hostname R1",
    },
    {
      foreignId: "2",
      name: "R2",
      templateName: "vios",
      imageName: "vios",
      runtimeHint: "qemu",
      position: { x: 200, y: 20 },
      interfaceNames: ["Gi0/0"],
    },
  ],
  links: [
    {
      sourceNodeId: "1",
      sourceInterface: "Gi0/0",
      targetNodeId: "2",
      targetInterface: "Gi0/0",
      networkName: "net1",
    },
  ],
};

describe("buildLabDocumentFromImport", () => {
  it("creates a valid lab document with nodes, network, attachment, and config set", () => {
    const document = buildLabDocumentFromImport({
      labId: "lab-import",
      labName: "Imported",
      topology,
      resolvedMappings: new Map([
        ["qemu:vios:vios", { template, imageId: "img-vios" }],
      ]),
    });

    expect(document.nodes).toHaveLength(2);
    expect(document.nodes[0]).toMatchObject({
      name: "R1",
      templateId: "cisco-iosv",
      imageId: "img-vios",
      config: { interfaceCount: 1, ramMb: 512 },
    });
    expect(document.networks).toHaveLength(1);
    expect(document.attachments).toHaveLength(2);
    expect(document.startupConfigSets[0]?.nodeConfigs[0]?.config).toBe(
      "hostname R1",
    );
  });

  it("omits excluded imported nodes and their links", () => {
    const document = buildLabDocumentFromImport({
      labId: "lab-import",
      labName: "Imported",
      topology,
      resolvedMappings: new Map([
        ["qemu:vios:vios", { template, imageId: "img-vios" }],
      ]),
      excludedNodeIds: ["2"],
    });

    expect(document.nodes).toHaveLength(1);
    expect(document.nodes[0]?.name).toBe("R1");
    expect(document.networks).toHaveLength(0);
    expect(document.attachments).toHaveLength(0);
    expect(document.startupConfigSets[0]?.nodeConfigs).toHaveLength(1);
  });
});
