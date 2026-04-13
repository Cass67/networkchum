import { describe, expect, it } from "vitest";

import type { LabDocument } from "@networkchum/shared";

import {
  buildBridgeTargetByNetworkId,
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
  it("uses a pre-existing host bridge as the target bridge for a cloud-backed network", async () => {
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
            bridgeInterface: "br-mgmt",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-cloud-0", networkId: "net-1" }],
    });

    const result = await buildBridgeTargetByNetworkId(
      lab,
      async (interfaceName) => interfaceName === "br-mgmt",
    );

    expect(result).toEqual(new Map([["net-1", "br-mgmt"]]));
  });

  it("ignores cloud uplinks that are raw host interfaces instead of bridges", async () => {
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
            bridgeInterface: "enp6s18",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-cloud-0", networkId: "net-1" }],
    });

    const result = await buildBridgeTargetByNetworkId(lab, async () => false);

    expect(result).toEqual(new Map());
  });

  it("does not detach a host bridge during cloud power-off", async () => {
    await expect(
      shouldDetachCloudUplink(
        "br-mgmt",
        async (interfaceName) => interfaceName === "br-mgmt",
      ),
    ).resolves.toBe(false);
  });
});
