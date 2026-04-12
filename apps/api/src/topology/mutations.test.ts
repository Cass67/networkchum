import { describe, expect, it } from "vitest";

import type { LabDocument } from "@networkchum/shared";

import {
  detachInterface,
  moveNode,
  removeNetwork,
  removeNode,
} from "./mutations.js";
import * as mutations from "./mutations.js";

function makeDocument(overrides: Partial<LabDocument> = {}): LabDocument {
  return {
    id: "lab-1",
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

describe("moveNode", () => {
  it("updates position for the correct node", () => {
    const doc = makeDocument({
      nodes: [
        {
          id: "node-a",
          name: "A",
          runtime: "container",
          templateId: "tpl-1",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 512, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [],
        },
        {
          id: "node-b",
          name: "B",
          runtime: "container",
          templateId: "tpl-1",
          imageId: null,
          position: { x: 10, y: 10 },
          config: { vcpu: 1, ramMb: 512, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [],
        },
      ],
    });

    const result = moveNode(doc, "node-a", { x: 42, y: 99 });

    expect(result.nodes[0]?.position).toEqual({ x: 42, y: 99 });
    expect(result.nodes[1]?.position).toEqual({ x: 10, y: 10 });
  });

  it("does not mutate other nodes", () => {
    const doc = makeDocument({
      nodes: [
        {
          id: "node-a",
          name: "A",
          runtime: "container",
          templateId: "tpl-1",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 512, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [],
        },
        {
          id: "node-b",
          name: "B",
          runtime: "container",
          templateId: "tpl-1",
          imageId: null,
          position: { x: 10, y: 10 },
          config: { vcpu: 1, ramMb: 512, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [],
        },
      ],
    });

    const result = moveNode(doc, "node-a", { x: 5, y: 5 });

    expect(result.nodes[1]).toBe(doc.nodes[1]);
  });
});

describe("detachInterface", () => {
  it("removes the correct attachment", () => {
    const doc = makeDocument({
      attachments: [
        { interfaceId: "if-1", networkId: "net-1" },
        { interfaceId: "if-2", networkId: "net-1" },
      ],
    });

    const result = detachInterface(doc, "if-1");

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.interfaceId).toBe("if-2");
  });

  it("leaves other attachments intact", () => {
    const doc = makeDocument({
      attachments: [
        { interfaceId: "if-1", networkId: "net-1" },
        { interfaceId: "if-2", networkId: "net-2" },
        { interfaceId: "if-3", networkId: "net-1" },
      ],
    });

    const result = detachInterface(doc, "if-2");

    expect(result.attachments).toEqual([
      { interfaceId: "if-1", networkId: "net-1" },
      { interfaceId: "if-3", networkId: "net-1" },
    ]);
  });
});

describe("removeNode", () => {
  it("removes the node and all interface attachments", () => {
    const doc = makeDocument({
      nodes: [
        {
          id: "node-a",
          name: "A",
          runtime: "container",
          templateId: "tpl-1",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 512, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-a-0", networkId: "net-1" }],
    });

    const result = removeNode(doc, "node-a");

    expect(result.nodes).toHaveLength(0);
    expect(result.attachments).toHaveLength(0);
  });

  it("removes boot action state for the removed node", () => {
    const doc = makeDocument({
      nodes: [
        {
          id: "node-a",
          name: "A",
          runtime: "container",
          templateId: "tpl-1",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 512, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [],
        },
      ],
      nodeBootActions: [{ nodeId: "node-a", action: "inject-once" }],
    });

    const result = removeNode(doc, "node-a");

    expect(result.nodeBootActions).toEqual([]);
  });
});

describe("removeNetwork", () => {
  it("removes the network and its attachments", () => {
    const doc = makeDocument({
      networks: [
        { id: "net-1", kind: "ethernet", name: "link", visible: false },
      ],
      attachments: [{ interfaceId: "if-a-0", networkId: "net-1" }],
    });

    const result = removeNetwork(doc, "net-1");

    expect(result.networks).toHaveLength(0);
    expect(result.attachments).toHaveLength(0);
  });
});

describe("node boot action", () => {
  it("persists a boot action for a node", () => {
    const doc = makeDocument({
      nodes: [
        {
          id: "node-a",
          name: "A",
          runtime: "container",
          templateId: "tpl-1",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 512, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [],
        },
      ],
      nodeBootActions: [],
    });

    const updated = mutations.setNodeBootAction(doc, "node-a", "inject-once");
    expect(
      updated.nodeBootActions.map(({ nodeId, action }) => ({ nodeId, action })),
    ).toEqual([{ nodeId: "node-a", action: "inject-once" }]);
    const [updatedEntry] = updated.nodeBootActions;
    expect(updatedEntry?.updatedAt).toBeDefined();
    expect(Number.isNaN(Date.parse(updatedEntry?.updatedAt ?? ""))).toBe(false);

    const cleared = mutations.setNodeBootAction(updated, "node-a", "none");
    expect(cleared.nodeBootActions).toEqual([]);
  });

  it("updates an existing boot action for the same node", () => {
    const doc = makeDocument({
      nodes: [
        {
          id: "node-a",
          name: "A",
          runtime: "container",
          templateId: "tpl-1",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 512, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [],
        },
        {
          id: "node-b",
          name: "B",
          runtime: "container",
          templateId: "tpl-1",
          imageId: null,
          position: { x: 10, y: 10 },
          config: { vcpu: 1, ramMb: 512, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [],
        },
      ],
      nodeBootActions: [
        {
          nodeId: "node-a",
          action: "inject-once",
          updatedAt: "2020-01-01T00:00:00.000Z",
        },
        {
          nodeId: "node-b",
          action: "backup-once",
          updatedAt: "2020-01-01T00:00:01.000Z",
        },
      ],
    });

    const originalTimestamp =
      doc.nodeBootActions.find((entry) => entry.nodeId === "node-a")
        ?.updatedAt ?? null;

    const updated = mutations.setNodeBootAction(doc, "node-a", "backup-once");

    expect(
      updated.nodeBootActions
        .filter((entry) => entry.nodeId !== "node-a")
        .map(({ nodeId, action }) => ({ nodeId, action })),
    ).toContainEqual({ nodeId: "node-b", action: "backup-once" });
    const [updatedAEntry] = updated.nodeBootActions.filter(
      (entry) => entry.nodeId === "node-a",
    );
    expect(updatedAEntry).toEqual(
      expect.objectContaining({ nodeId: "node-a", action: "backup-once" }),
    );
    expect(updatedAEntry?.updatedAt).toBeDefined();
    expect(Number.isNaN(Date.parse(updatedAEntry?.updatedAt ?? ""))).toBe(
      false,
    );
    expect(updatedAEntry?.updatedAt).not.toBe(originalTimestamp);
  });
});
