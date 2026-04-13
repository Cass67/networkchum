import { describe, expect, it } from "vitest";

import type { LabDocument } from "@networkchum/shared";

import {
  buildBridgeTargetByNetworkId,
  validateCloudBridgeTargets,
  shouldDetachCloudUplink,
} from "./cloudUplink.js";

function makeLab(overrides: Partial<LabDocument> = {}): LabDocument {
  return {
    id: "lab-abc123",
    name: "Test Lab",
    version: 1,
    canvas: { zoom: 1, backgroundImage: null },
    nodes: [],
    networks: [],
    attachments: [],
    annotations: [],
    startupConfigSets: [],
    nodeBootActions: [],
    activeConfigSetId: null,
    ...overrides,
  };
}

describe("cloudUplink", () => {
  it("uses the managed management bridge for management cloud networks", async () => {
    const lab = makeLab({
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "cloud-a",
          name: "mgmt",
          runtime: "cloud",
          templateId: "cloud",
          position: { x: 0, y: 0 },
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 1,
            cloudRole: "management",
            bridgeGroup: "management",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-cloud-0", networkId: "net-1" }],
    });

    const result = await buildBridgeTargetByNetworkId(lab);

    expect(result).toEqual(new Map([["net-1", "nc-mgmt"]]));
  });

  it("uses separate managed bridge names for private circuit groups", async () => {
    const lab = makeLab({
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "cloud-a",
          name: "mgmt",
          runtime: "cloud",
          templateId: "cloud",
          position: { x: 0, y: 0 },
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 1,
            cloudRole: "private-circuit",
            bridgeGroup: "mpls-core",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-cloud-0", networkId: "net-1" }],
    });

    const result = await buildBridgeTargetByNetworkId(lab);

    expect(result.get("net-1")).toMatch(/^nc-pv-/);
  });

  it("rejects private clouds that do not define a bridge group", async () => {
    const lab = makeLab({
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "cloud-a",
          name: "mpls",
          runtime: "cloud",
          templateId: "cloud",
          position: { x: 0, y: 0 },
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 1,
            cloudRole: "private-circuit",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-cloud-0", networkId: "net-1" }],
    });

    const result = await validateCloudBridgeTargets(lab, undefined);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected missing bridge group validation to fail");
    }
    expect(result.message).toContain("bridge group");
  });

  it("does not detach managed cloud bridges during cloud power-off", async () => {
    await expect(shouldDetachCloudUplink("nc-mgmt")).resolves.toBe(false);
  });
});
