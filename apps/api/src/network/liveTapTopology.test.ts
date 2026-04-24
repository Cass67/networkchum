import { describe, expect, it, vi } from "vitest";

import type { LabDocument } from "@networkchum/shared";

import type { RuntimeState } from "../runtime/runtimeStateStore.js";
import {
  detachRunningInterfaceFromBridge,
  syncRunningCloudNodeBridgeInterface,
  syncRunningNodesForInterfaces,
} from "./liveTapTopology.js";

function makeLab(overrides: Partial<LabDocument> = {}): LabDocument {
  return {
    id: "lab-abc123",
    name: "Test Lab",
    version: 1,
    canvas: { zoom: 1, backgroundImage: null, drawings: [] },
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

function makeRuntimeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    labId: "lab-abc123",
    nodeId: "node-a",
    status: "running",
    runtime: "qemu",
    accelerationMode: null,
    commandPreview: [],
    updatedAt: "2026-04-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("liveTapTopology", () => {
  it("reconciles tap networking for changed interfaces on running nodes", async () => {
    const document = makeLab({
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
        {
          id: "node-b",
          name: "router",
          runtime: "qemu",
          templateId: "tmpl",
          imageId: null,
          position: { x: 100, y: 0 },
          config: { vcpu: 1, ramMb: 1024, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-b-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [
        { interfaceId: "if-cloud-0", networkId: "net-1" },
        { interfaceId: "if-b-0", networkId: "net-1" },
      ],
    });

    const runCommand = vi.fn();
    const ensureTapNetworking = vi.fn().mockResolvedValue({ ok: true });

    await syncRunningNodesForInterfaces(
      document.id,
      document,
      ["if-cloud-0", "if-b-0"],
      { runCommand },
      {
        networkBackend: "tap",
        listRuntimeStates: async () => [
          makeRuntimeState({
            nodeId: "cloud-a",
            runtime: "cloud",
          }),
          makeRuntimeState({
            nodeId: "node-b",
            runtime: "qemu",
            status: "stopped",
          }),
        ],
        ensureTapNetworking,
      },
    );

    expect(ensureTapNetworking).toHaveBeenCalledTimes(1);
    expect(ensureTapNetworking.mock.calls[0]?.[0]).toBe(document);
    expect(ensureTapNetworking.mock.calls[0]?.[1]).toBe(runCommand);
    expect(ensureTapNetworking.mock.calls[0]?.[3]).toBe("cloud-a");
  });

  it("detaches a running qemu tap from its bridge when a cable is removed", async () => {
    const document = makeLab({
      nodes: [
        {
          id: "node-a",
          name: "router",
          runtime: "qemu",
          templateId: "tmpl",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 1024, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
    });

    const runCommand = vi
      .fn()
      .mockResolvedValue({ ok: true, stdout: "", stderr: "" });

    await detachRunningInterfaceFromBridge(
      document.id,
      document,
      "if-a-0",
      { runCommand },
      {
        networkBackend: "tap",
        listRuntimeStates: async () => [makeRuntimeState()],
      },
    );

    expect(runCommand).toHaveBeenCalledWith("ip", [
      "link",
      "set",
      "dev",
      "tap-c123-odea-0",
      "nomaster",
    ]);
  });

  it("moves a running cloud node from the old uplink to the new one", async () => {
    const previousDocument = makeLab({
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
            bridgeInterface: "eno1",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-cloud-0", networkId: "net-1" }],
    });

    const nextDocument = makeLab({
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
        {
          id: "node-b",
          name: "router",
          runtime: "qemu",
          templateId: "tmpl",
          imageId: null,
          position: { x: 100, y: 0 },
          config: { vcpu: 1, ramMb: 1024, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-b-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [
        { interfaceId: "if-cloud-0", networkId: "net-1" },
        { interfaceId: "if-b-0", networkId: "net-1" },
      ],
    });

    const runCommand = vi
      .fn()
      .mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    const ensureTapNetworking = vi.fn().mockResolvedValue({ ok: true });

    await syncRunningCloudNodeBridgeInterface(
      previousDocument.id,
      previousDocument,
      nextDocument,
      "cloud-a",
      { runCommand },
      {
        networkBackend: "tap",
        listRuntimeStates: async () => [
          makeRuntimeState({
            nodeId: "cloud-a",
            runtime: "cloud",
          }),
          makeRuntimeState({
            nodeId: "node-b",
            runtime: "qemu",
          }),
        ],
        ensureTapNetworking,
      },
    );

    expect(runCommand).toHaveBeenCalledWith("ip", [
      "link",
      "set",
      "dev",
      "eno1",
      "nomaster",
    ]);
    expect(ensureTapNetworking).toHaveBeenCalledTimes(2);
    expect(ensureTapNetworking.mock.calls[0]?.[0]).toBe(nextDocument);
    expect(ensureTapNetworking.mock.calls[1]?.[0]).toBe(nextDocument);
    expect(ensureTapNetworking.mock.calls.map((call) => call[3])).toEqual([
      "cloud-a",
      "node-b",
    ]);
  });

  it("does not detach a host bridge when a cloud cable is removed", async () => {
    const document = makeLab({
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
    });

    const runCommand = vi
      .fn()
      .mockResolvedValue({ ok: true, stdout: "", stderr: "" });

    await detachRunningInterfaceFromBridge(
      document.id,
      document,
      "if-cloud-0",
      { runCommand },
      {
        networkBackend: "tap",
        listRuntimeStates: async () => [
          makeRuntimeState({
            nodeId: "cloud-a",
            runtime: "cloud",
          }),
        ],
        isBridgeInterface: async (interfaceName) => interfaceName === "br-mgmt",
      },
    );

    expect(runCommand).not.toHaveBeenCalled();
  });
});
