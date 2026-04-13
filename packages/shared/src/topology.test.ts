import { describe, expect, it } from "vitest";

import { LabDocumentSchema } from "./topology.js";

describe("LabDocumentSchema", () => {
  it("accepts a minimal lab document", () => {
    const result = LabDocumentSchema.parse({
      id: "lab-1",
      name: "demo",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      nodes: [],
      networks: [],
      attachments: [],
      annotations: [],
      startupConfigSets: [],
      activeConfigSetId: null,
    });

    expect(result.name).toBe("demo");
  });

  it("normalizes legacy single boot actions into split startup and backup modes", () => {
    const result = LabDocumentSchema.parse({
      id: "lab-1",
      name: "demo",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      nodes: [],
      networks: [],
      attachments: [],
      annotations: [],
      startupConfigSets: [],
      nodeBootActions: [{ nodeId: "node-1", action: "inject-once" }],
      activeConfigSetId: null,
    });

    expect(result.nodeBootActions).toEqual([
      {
        nodeId: "node-1",
        startupConfig: "once",
        runningConfigBackup: "none",
      },
    ]);
  });

  it("accepts cloud nodes with zero compute resources", () => {
    const result = LabDocumentSchema.parse({
      id: "lab-1",
      name: "demo",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      nodes: [
        {
          id: "node-1",
          name: "cloud-1",
          runtime: "cloud",
          templateId: "cloud",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 0, ramMb: 0, interfaceCount: 10 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-1", name: "eth0", slot: 0 }],
        },
      ],
      networks: [],
      attachments: [],
      annotations: [],
      startupConfigSets: [],
      nodeBootActions: [],
      activeConfigSetId: null,
    });

    expect(result.nodes[0]?.runtime).toBe("cloud");
  });
});
