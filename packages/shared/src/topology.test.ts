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

  it("accepts explicit cloud role and bridge group settings", () => {
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
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 10,
            cloudRole: "private-circuit",
            bridgeGroup: "mpls-core",
          },
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

    expect(result.nodes[0]?.config.cloudRole).toBe("private-circuit");
    expect(result.nodes[0]?.config.bridgeGroup).toBe("mpls-core");
  });

  it("accepts container nodes with resolved image and runtime metadata", () => {
    const result = LabDocumentSchema.parse({
      id: "lab-1",
      name: "demo",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      nodes: [
        {
          id: "node-1",
          name: "container-1",
          runtime: "container",
          templateId: "container-oraclelinux",
          imageId: null,
          position: { x: 0, y: 0 },
          config: {
            vcpu: 1,
            ramMb: 512,
            interfaceCount: 1,
            containerImageRef: "oraclelinux:9-slim",
            containerRegistry: "docker-hub",
            containerEngine: "podman",
            containerShell: "sh",
          },
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

    expect(result.nodes[0]?.config.containerImageRef).toBe(
      "oraclelinux:9-slim",
    );
    expect(result.nodes[0]?.config.containerEngine).toBe("podman");
  });

  it("normalizes legacy management bridge configs into role and group", () => {
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
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 10,
            bridgeInterface: "br-mgmt",
          },
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

    expect(result.nodes[0]?.config.cloudRole).toBe("management");
    expect(result.nodes[0]?.config.bridgeGroup).toBe("management");
  });
});
