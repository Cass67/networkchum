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
    });

    expect(result.name).toBe("demo");
  });
});
