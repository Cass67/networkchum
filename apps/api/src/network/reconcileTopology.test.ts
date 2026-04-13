import { describe, expect, it } from "vitest";

import type { LabDocument } from "@networkchum/shared";

import { reconcileTopology } from "./reconcileTopology.js";

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

describe("reconcileTopology", () => {
  it("produces no operations for an empty topology", () => {
    const lab = makeLab();
    expect(reconcileTopology(lab)).toEqual([]);
  });

  it("creates a bridge for each network segment", () => {
    const lab = makeLab({
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN 1", visible: false },
        { id: "net-2", kind: "ethernet", name: "LAN 2", visible: false },
      ],
    });

    const ops = reconcileTopology(lab);

    expect(ops).toEqual([
      { kind: "create-bridge", bridgeName: "nc-br-net1" },
      { kind: "set-interface-up", interfaceName: "nc-br-net1" },
      { kind: "create-bridge", bridgeName: "nc-br-net2" },
      { kind: "set-interface-up", interfaceName: "nc-br-net2" },
    ]);
  });

  it("creates and attaches TAPs for interfaces on the same network", () => {
    const lab = makeLab({
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "node-a",
          name: "host-a",
          runtime: "qemu",
          templateId: "tmpl",
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 256, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
        {
          id: "node-b",
          name: "host-b",
          runtime: "qemu",
          templateId: "tmpl",
          position: { x: 100, y: 0 },
          config: { vcpu: 1, ramMb: 256, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-b-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [
        { interfaceId: "if-a-0", networkId: "net-1" },
        { interfaceId: "if-b-0", networkId: "net-1" },
      ],
    });

    const ops = reconcileTopology(lab);

    expect(ops).toEqual([
      { kind: "create-bridge", bridgeName: "nc-br-net1" },
      { kind: "set-interface-up", interfaceName: "nc-br-net1" },
      { kind: "create-tap", tapName: "tap-c123-odea-0" },
      { kind: "set-interface-up", interfaceName: "tap-c123-odea-0" },
      {
        kind: "attach-to-bridge",
        interfaceName: "tap-c123-odea-0",
        bridgeName: "nc-br-net1",
      },
      { kind: "create-tap", tapName: "tap-c123-odeb-0" },
      { kind: "set-interface-up", interfaceName: "tap-c123-odeb-0" },
      {
        kind: "attach-to-bridge",
        interfaceName: "tap-c123-odeb-0",
        bridgeName: "nc-br-net1",
      },
    ]);
  });

  it("creates taps for unattached interfaces without bridging them", () => {
    const lab = makeLab({
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "node-a",
          name: "host-a",
          runtime: "qemu",
          templateId: "tmpl",
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 256, interfaceCount: 2 },
          state: { desiredPower: "off" },
          interfaces: [
            { id: "if-a-0", name: "eth0", slot: 0 },
            { id: "if-a-1", name: "eth1", slot: 1 },
          ],
        },
      ],
      attachments: [{ interfaceId: "if-a-0", networkId: "net-1" }],
    });

    const ops = reconcileTopology(lab);
    const tapOps = ops.filter((op) => op.kind === "create-tap");
    const attachOps = ops.filter((op) => op.kind === "attach-to-bridge");

    expect(tapOps).toHaveLength(2);
    expect(tapOps).toEqual([
      { kind: "create-tap", tapName: "tap-c123-odea-0" },
      { kind: "create-tap", tapName: "tap-c123-odea-1" },
    ]);
    expect(attachOps).toEqual([
      {
        kind: "attach-to-bridge",
        interfaceName: "tap-c123-odea-0",
        bridgeName: "nc-br-net1",
      },
    ]);
  });

  it("produces separate bridges for multiple networks", () => {
    const lab = makeLab({
      networks: [
        { id: "net-alpha", kind: "ethernet", name: "Alpha", visible: false },
        { id: "net-beta", kind: "ethernet", name: "Beta", visible: false },
      ],
      nodes: [
        {
          id: "node-a",
          name: "host-a",
          runtime: "qemu",
          templateId: "tmpl",
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 256, interfaceCount: 2 },
          state: { desiredPower: "off" },
          interfaces: [
            { id: "if-a-0", name: "eth0", slot: 0 },
            { id: "if-a-1", name: "eth1", slot: 1 },
          ],
        },
      ],
      attachments: [
        { interfaceId: "if-a-0", networkId: "net-alpha" },
        { interfaceId: "if-a-1", networkId: "net-beta" },
      ],
    });

    const ops = reconcileTopology(lab);
    const bridgeOps = ops.filter((op) => op.kind === "create-bridge");

    expect(bridgeOps).toHaveLength(2);
    expect(bridgeOps[0]).toEqual({
      kind: "create-bridge",
      bridgeName: "nc-br-netalpha",
    });
    expect(bridgeOps[1]).toEqual({
      kind: "create-bridge",
      bridgeName: "nc-br-netbeta",
    });

    const attachOps = ops.filter((op) => op.kind === "attach-to-bridge");
    expect(attachOps[0]).toEqual({
      kind: "attach-to-bridge",
      interfaceName: "tap-c123-odea-0",
      bridgeName: "nc-br-netalpha",
    });
    expect(attachOps[1]).toEqual({
      kind: "attach-to-bridge",
      interfaceName: "tap-c123-odea-1",
      bridgeName: "nc-br-netbeta",
    });
  });

  it("can limit tap operations to a single node", () => {
    const lab = makeLab({
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "node-a",
          name: "host-a",
          runtime: "qemu",
          templateId: "tmpl",
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 256, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
        {
          id: "node-b",
          name: "host-b",
          runtime: "qemu",
          templateId: "tmpl",
          position: { x: 100, y: 0 },
          config: { vcpu: 1, ramMb: 256, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-b-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [
        { interfaceId: "if-a-0", networkId: "net-1" },
        { interfaceId: "if-b-0", networkId: "net-1" },
      ],
    });

    const ops = reconcileTopology(lab, "node-b");

    expect(ops).toEqual([
      { kind: "create-bridge", bridgeName: "nc-br-net1" },
      { kind: "set-interface-up", interfaceName: "nc-br-net1" },
      { kind: "create-tap", tapName: "tap-c123-odeb-0" },
      { kind: "set-interface-up", interfaceName: "tap-c123-odeb-0" },
      {
        kind: "attach-to-bridge",
        interfaceName: "tap-c123-odeb-0",
        bridgeName: "nc-br-net1",
      },
    ]);
  });

  it("does not attach a raw host interface for cloud nodes without a bridge target", () => {
    const lab = makeLab({
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "cloud-a",
          name: "cloud-a",
          runtime: "cloud",
          templateId: "cloud",
          position: { x: 0, y: 0 },
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 1,
            bridgeInterface: "eno1",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-cloud-0", networkId: "net-1" }],
    });

    const ops = reconcileTopology(lab);

    expect(ops).not.toContainEqual({
      kind: "attach-to-bridge",
      interfaceName: "eno1",
      bridgeName: "nc-br-net1",
    });
  });

  it("attaches network members directly to an existing host bridge target", () => {
    const lab = makeLab({
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "cloud-a",
          name: "cloud-a",
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
        {
          id: "node-a",
          name: "router-a",
          runtime: "qemu",
          templateId: "tmpl",
          position: { x: 100, y: 0 },
          config: { vcpu: 1, ramMb: 256, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [
        { interfaceId: "if-cloud-0", networkId: "net-1" },
        { interfaceId: "if-a-0", networkId: "net-1" },
      ],
    });

    const ops = reconcileTopology(
      lab,
      undefined,
      new Map([["net-1", "br-mgmt"]]),
    );

    expect(ops).not.toContainEqual({
      kind: "create-bridge",
      bridgeName: "nc-br-net1",
    });
    expect(ops).toContainEqual({
      kind: "attach-to-bridge",
      interfaceName: "tap-c123-odea-0",
      bridgeName: "br-mgmt",
    });
    expect(ops).not.toContainEqual({
      kind: "attach-to-bridge",
      interfaceName: "br-mgmt",
      bridgeName: "nc-br-net1",
    });
  });
});
