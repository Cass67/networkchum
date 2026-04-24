import { describe, expect, it, vi } from "vitest";

import { syncSocketTopology } from "./syncSocketTopology.js";

describe("syncSocketTopology", () => {
  it("rebuilds socket switch state from all running qemu nodes and lab attachments", async () => {
    const reset = vi.fn();
    const addNic = vi.fn();
    const removeNic = vi.fn();
    const syncAttachments = vi.fn();

    const result = await syncSocketTopology({
      getNetworkBackend: () => "socket",
      listLabs: async () => [
        {
          id: "lab-1",
          name: "Lab 1",
          updatedAt: "2026-04-11T00:00:00.000Z",
          document: {
            id: "lab-1",
            name: "Lab 1",
            version: 1,
            canvas: { zoom: 1, backgroundImage: null, drawings: [] },
            annotations: [],
            startupConfigSets: [],
            nodeBootActions: [],
            activeConfigSetId: null,
            nodes: [
              {
                id: "node-a",
                name: "arista-1",
                runtime: "qemu",
                templateId: "arista-veos",
                imageId: "img-a",
                position: { x: 0, y: 0 },
                config: { vcpu: 1, ramMb: 4096, interfaceCount: 2 },
                state: { desiredPower: "on" },
                interfaces: [
                  { id: "if-a-0", name: "eth0", slot: 0 },
                  { id: "if-a-1", name: "eth1", slot: 1 },
                ],
              },
            ],
            networks: [
              { id: "net-1", kind: "ethernet", name: "LAN 1", visible: true },
            ],
            attachments: [{ interfaceId: "if-a-1", networkId: "net-1" }],
          },
        },
        {
          id: "lab-2",
          name: "Lab 2",
          updatedAt: "2026-04-11T00:00:00.000Z",
          document: {
            id: "lab-2",
            name: "Lab 2",
            version: 1,
            canvas: { zoom: 1, backgroundImage: null, drawings: [] },
            annotations: [],
            startupConfigSets: [],
            nodeBootActions: [],
            activeConfigSetId: null,
            nodes: [
              {
                id: "node-b",
                name: "arista-2",
                runtime: "qemu",
                templateId: "arista-veos",
                imageId: "img-b",
                position: { x: 200, y: 0 },
                config: { vcpu: 1, ramMb: 4096, interfaceCount: 2 },
                state: { desiredPower: "on" },
                interfaces: [
                  { id: "if-b-0", name: "eth0", slot: 0 },
                  { id: "if-b-1", name: "eth1", slot: 1 },
                ],
              },
            ],
            networks: [
              { id: "net-2", kind: "ethernet", name: "LAN 2", visible: true },
            ],
            attachments: [{ interfaceId: "if-b-1", networkId: "net-2" }],
          },
        },
      ],
      listRuntimeStates: async () => [
        {
          labId: "lab-1",
          nodeId: "node-a",
          status: "running",
          runtime: "qemu",
          accelerationMode: "hvf",
          nicPorts: [20000, 20001],
          commandPreview: ["qemu-system-x86_64"],
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
        {
          labId: "lab-2",
          nodeId: "node-b",
          status: "running",
          runtime: "qemu",
          accelerationMode: "hvf",
          nicPorts: [20002, 20003],
          commandPreview: ["qemu-system-x86_64"],
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
        {
          labId: "lab-2",
          nodeId: "node-c",
          status: "stopped",
          runtime: "qemu",
          accelerationMode: "hvf",
          nicPorts: [20004, 20005],
          commandPreview: ["qemu-system-x86_64"],
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
      ],
      switchAdapter: {
        reset,
        addNic,
        removeNic,
        syncAttachments,
      },
    });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(addNic).toHaveBeenCalledTimes(4);
    expect(addNic).toHaveBeenCalledWith("if-a-0", 20000);
    expect(addNic).toHaveBeenCalledWith("if-a-1", 20001);
    expect(addNic).toHaveBeenCalledWith("if-b-0", 20002);
    expect(addNic).toHaveBeenCalledWith("if-b-1", 20003);
    expect(syncAttachments).toHaveBeenCalledWith([
      { interfaceId: "if-a-1", networkId: "net-1" },
      { interfaceId: "if-b-1", networkId: "net-2" },
    ]);
    expect(result).toEqual({ labs: 2, qemuNodes: 2, nics: 4, attachments: 2 });
  });

  it("skips qemu nics that are backed by macos management instead of a socket port", async () => {
    const reset = vi.fn();
    const addNic = vi.fn();
    const removeNic = vi.fn();
    const syncAttachments = vi.fn();

    const result = await syncSocketTopology({
      getNetworkBackend: () => "socket",
      listLabs: async () => [
        {
          id: "lab-1",
          name: "Lab 1",
          updatedAt: "2026-04-11T00:00:00.000Z",
          document: {
            id: "lab-1",
            name: "Lab 1",
            version: 1,
            canvas: { zoom: 1, backgroundImage: null, drawings: [] },
            annotations: [],
            startupConfigSets: [],
            nodeBootActions: [],
            activeConfigSetId: null,
            nodes: [
              {
                id: "node-a",
                name: "iosv-1",
                runtime: "qemu",
                templateId: "cisco-iosv",
                imageId: "img-a",
                position: { x: 0, y: 0 },
                config: { vcpu: 1, ramMb: 4096, interfaceCount: 2 },
                state: { desiredPower: "on" },
                interfaces: [
                  { id: "if-a-0", name: "eth0", slot: 0 },
                  { id: "if-a-1", name: "eth1", slot: 1 },
                ],
              },
            ],
            networks: [
              { id: "net-1", kind: "ethernet", name: "LAN 1", visible: true },
            ],
            attachments: [{ interfaceId: "if-a-1", networkId: "net-1" }],
          },
        },
      ],
      listRuntimeStates: async () => [
        {
          labId: "lab-1",
          nodeId: "node-a",
          status: "running",
          runtime: "qemu",
          accelerationMode: "hvf",
          nicPorts: [20000, 20001],
          nicBackends: ["macos-management", null],
          commandPreview: ["qemu-system-x86_64"],
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
      ],
      switchAdapter: {
        reset,
        addNic,
        removeNic,
        syncAttachments,
      },
    });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(addNic).toHaveBeenCalledTimes(1);
    expect(addNic).toHaveBeenCalledWith("if-a-1", 20001);
    expect(syncAttachments).toHaveBeenCalledWith([
      { interfaceId: "if-a-1", networkId: "net-1" },
    ]);
    expect(result).toEqual({ labs: 1, qemuNodes: 1, nics: 1, attachments: 1 });
  });

  it("skips management-backed qemu nics during rebuild when legacy runtime states lack nicBackends", async () => {
    const reset = vi.fn();
    const addNic = vi.fn();
    const removeNic = vi.fn();
    const syncAttachments = vi.fn();

    const result = await syncSocketTopology({
      getNetworkBackend: () => "socket",
      listLabs: async () => [
        {
          id: "lab-1",
          name: "Lab 1",
          updatedAt: "2026-04-11T00:00:00.000Z",
          document: {
            id: "lab-1",
            name: "Lab 1",
            version: 1,
            canvas: { zoom: 1, backgroundImage: null, drawings: [] },
            annotations: [],
            startupConfigSets: [],
            nodeBootActions: [],
            activeConfigSetId: null,
            nodes: [
              {
                id: "node-a",
                name: "iosv-1",
                runtime: "qemu",
                templateId: "cisco-iosv",
                imageId: "img-a",
                position: { x: 0, y: 0 },
                config: { vcpu: 1, ramMb: 4096, interfaceCount: 2 },
                state: { desiredPower: "on" },
                interfaces: [
                  { id: "if-a-0", name: "eth0", slot: 0 },
                  { id: "if-a-1", name: "eth1", slot: 1 },
                ],
              },
              {
                id: "cloud-a",
                name: "mgmt",
                runtime: "cloud",
                templateId: "cloud",
                imageId: null,
                position: { x: 200, y: 0 },
                config: {
                  vcpu: 0,
                  ramMb: 0,
                  interfaceCount: 1,
                  cloudRole: "management",
                  bridgeGroup: "management",
                },
                state: { desiredPower: "on" },
                interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
              },
            ],
            networks: [
              {
                id: "net-mgmt",
                kind: "ethernet",
                name: "Mgmt",
                visible: true,
              },
              { id: "net-lan", kind: "ethernet", name: "LAN", visible: true },
            ],
            attachments: [
              { interfaceId: "if-cloud-0", networkId: "net-mgmt" },
              // NIC0: management-backed, should not be registered as a socket NIC
              { interfaceId: "if-a-0", networkId: "net-mgmt" },
              { interfaceId: "if-a-1", networkId: "net-lan" },
            ],
          },
        },
      ],
      listRuntimeStates: async () => [
        {
          labId: "lab-1",
          nodeId: "node-a",
          status: "running",
          runtime: "qemu",
          accelerationMode: "hvf",
          nicPorts: [20000, 20001],
          // Legacy running QEMU runtime states (pre-24095ff) did not persist
          // nicBackends, so rebuild must infer management-backed NICs from the
          // lab topology instead.
          commandPreview: ["qemu-system-x86_64"],
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
      ],
      switchAdapter: {
        reset,
        addNic,
        removeNic,
        syncAttachments,
      },
    });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(addNic).toHaveBeenCalledTimes(1);
    expect(addNic).toHaveBeenCalledWith("if-a-1", 20001);
    expect(syncAttachments).toHaveBeenCalledWith([
      { interfaceId: "if-cloud-0", networkId: "net-mgmt" },
      { interfaceId: "if-a-0", networkId: "net-mgmt" },
      { interfaceId: "if-a-1", networkId: "net-lan" },
    ]);
    expect(result).toEqual({ labs: 1, qemuNodes: 1, nics: 1, attachments: 3 });
  });

  it("keeps socket NICs alive when metadata explicitly records null nicBackends despite later management attachments", async () => {
    const reset = vi.fn();
    const addNic = vi.fn();
    const removeNic = vi.fn();
    const syncAttachments = vi.fn();

    const result = await syncSocketTopology({
      getNetworkBackend: () => "socket",
      listLabs: async () => [
        {
          id: "lab-1",
          name: "Lab 1",
          updatedAt: "2026-04-11T00:00:00.000Z",
          document: {
            id: "lab-1",
            name: "Lab 1",
            version: 1,
            canvas: { zoom: 1, backgroundImage: null, drawings: [] },
            annotations: [],
            startupConfigSets: [],
            nodeBootActions: [],
            activeConfigSetId: null,
            nodes: [
              {
                id: "node-a",
                name: "iosv-1",
                runtime: "qemu",
                templateId: "cisco-iosv",
                imageId: "img-a",
                position: { x: 0, y: 0 },
                config: { vcpu: 1, ramMb: 4096, interfaceCount: 2 },
                state: { desiredPower: "on" },
                interfaces: [
                  { id: "if-a-0", name: "eth0", slot: 0 },
                  { id: "if-a-1", name: "eth1", slot: 1 },
                ],
              },
              {
                id: "cloud-a",
                name: "mgmt",
                runtime: "cloud",
                templateId: "cloud",
                imageId: null,
                position: { x: 200, y: 0 },
                config: {
                  vcpu: 0,
                  ramMb: 0,
                  interfaceCount: 1,
                  cloudRole: "management",
                  bridgeGroup: "management",
                },
                state: { desiredPower: "on" },
                interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
              },
            ],
            networks: [
              {
                id: "net-mgmt",
                kind: "ethernet",
                name: "Mgmt",
                visible: true,
              },
              { id: "net-lan", kind: "ethernet", name: "LAN", visible: true },
            ],
            attachments: [
              { interfaceId: "if-cloud-0", networkId: "net-mgmt" },
              // The topology now attaches NIC0 to the management cloud.
              { interfaceId: "if-a-0", networkId: "net-mgmt" },
              { interfaceId: "if-a-1", networkId: "net-lan" },
            ],
          },
        },
      ],
      listRuntimeStates: async () => [
        {
          labId: "lab-1",
          nodeId: "node-a",
          status: "running",
          runtime: "qemu",
          accelerationMode: "hvf",
          nicPorts: [20000, 20001],
          // A fresh macOS socket launch persisted explicit null metadata.
          nicBackends: [null, null],
          commandPreview: ["qemu-system-x86_64"],
          updatedAt: "2026-04-11T00:00:00.000Z",
        },
      ],
      switchAdapter: {
        reset,
        addNic,
        removeNic,
        syncAttachments,
      },
    });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(addNic).toHaveBeenCalledTimes(2);
    expect(addNic).toHaveBeenCalledWith("if-a-0", 20000);
    expect(addNic).toHaveBeenCalledWith("if-a-1", 20001);
    expect(syncAttachments).toHaveBeenCalledWith([
      { interfaceId: "if-cloud-0", networkId: "net-mgmt" },
      { interfaceId: "if-a-0", networkId: "net-mgmt" },
      { interfaceId: "if-a-1", networkId: "net-lan" },
    ]);
    expect(result).toEqual({ labs: 1, qemuNodes: 1, nics: 2, attachments: 3 });
  });

  it("does nothing outside the socket backend", async () => {
    const reset = vi.fn();
    const addNic = vi.fn();
    const removeNic = vi.fn();
    const syncAttachments = vi.fn();

    const result = await syncSocketTopology({
      getNetworkBackend: () => "tap",
      listLabs: async () => {
        throw new Error("should not load labs for non-socket backends");
      },
      listRuntimeStates: async () => {
        throw new Error(
          "should not load runtime states for non-socket backends",
        );
      },
      switchAdapter: {
        reset,
        addNic,
        removeNic,
        syncAttachments,
      },
    });

    expect(reset).not.toHaveBeenCalled();
    expect(addNic).not.toHaveBeenCalled();
    expect(syncAttachments).not.toHaveBeenCalled();
    expect(result).toEqual({ labs: 0, qemuNodes: 0, nics: 0, attachments: 0 });
  });
});
