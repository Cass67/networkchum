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
    expect(result.canvas.drawings).toEqual([]);
  });

  it("accepts persistent canvas drawings in the lab file", () => {
    const result = LabDocumentSchema.parse({
      id: "lab-1",
      name: "demo",
      version: 1,
      canvas: {
        zoom: 1,
        backgroundImage: null,
        drawings: [
          {
            id: "shape-1",
            kind: "shape",
            shape: "rectangle",
            x: 20,
            y: 30,
            width: 180,
            height: 90,
            fill: "#dbeafe",
            stroke: "#2563eb",
            opacity: 0.4,
            locked: true,
            zIndex: 2,
          },
          {
            id: "image-1",
            kind: "image",
            x: 10,
            y: 12,
            width: 400,
            height: 240,
            src: "data:image/png;base64,aGVsbG8=",
            opacity: 0.8,
            locked: false,
            zIndex: 1,
          },
          {
            id: "text-1",
            kind: "text",
            x: 40,
            y: 42,
            width: 160,
            height: 48,
            text: "Core",
            fill: "#f8fafc",
            fontSize: 20,
            opacity: 1,
            locked: false,
            zIndex: 3,
          },
        ],
      },
      nodes: [],
      networks: [],
      attachments: [],
      annotations: [],
      startupConfigSets: [],
      activeConfigSetId: null,
    });

    expect(result.canvas.drawings).toHaveLength(3);
    expect(result.canvas.drawings[0]).toMatchObject({
      kind: "shape",
      shape: "rectangle",
      locked: true,
    });
    expect(result.canvas.drawings[2]).toMatchObject({
      kind: "text",
      text: "Core",
      fontSize: 20,
    });
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

  it("normalizes managed bridge prefixes produced by the current runtime", () => {
    const result = LabDocumentSchema.parse({
      id: "lab-1",
      name: "demo",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      nodes: [
        {
          id: "node-mgmt",
          name: "mgmt-cloud",
          runtime: "cloud",
          templateId: "cloud",
          imageId: null,
          position: { x: 0, y: 0 },
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 10,
            bridgeInterface: "nc-mg-management",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-mgmt", name: "eth0", slot: 0 }],
        },
        {
          id: "node-private",
          name: "private-cloud",
          runtime: "cloud",
          templateId: "cloud",
          imageId: null,
          position: { x: 120, y: 0 },
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 10,
            bridgeInterface: "nc-pv-mpls-core",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-private", name: "eth0", slot: 0 }],
        },
        {
          id: "node-carrier",
          name: "carrier-cloud",
          runtime: "cloud",
          templateId: "cloud",
          imageId: null,
          position: { x: 240, y: 0 },
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 10,
            bridgeInterface: "nc-is-isp-a",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-carrier", name: "eth0", slot: 0 }],
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
    expect(result.nodes[1]?.config.cloudRole).toBe("private-circuit");
    expect(result.nodes[1]?.config.bridgeGroup).toBe("mpls-core");
    expect(result.nodes[2]?.config.cloudRole).toBe("isp-carrier");
    expect(result.nodes[2]?.config.bridgeGroup).toBe("isp-a");
  });
});
