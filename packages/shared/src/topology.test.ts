import { describe, expect, it } from "vitest";

import { LabDocumentSchema } from "./topology.ts";

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
});
