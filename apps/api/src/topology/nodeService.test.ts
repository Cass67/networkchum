import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLab, getLab, updateLabDocument } from "../labs/labStore.js";
import { deleteNode } from "./nodeService.js";

let tempDataDir = "";

beforeEach(async () => {
  tempDataDir = await mkdtemp(
    path.join(os.tmpdir(), "networkchum-node-service-"),
  );
  process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
});

afterEach(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = "";
  }
});

describe("deleteNode", () => {
  it("removes the node, its attachments, and runtime state", async () => {
    const lab = await createLab("Node Service Lab");
    await updateLabDocument(lab.id, {
      ...lab.document,
      nodes: [
        {
          id: "node-1",
          name: "Node 1",
          runtime: "container",
          templateId: "linux-alpine-container",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 256, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-1", name: "eth0", slot: 0 }],
        },
      ],
      networks: [
        { id: "net-1", kind: "ethernet", name: "link", visible: false },
      ],
      attachments: [{ interfaceId: "if-1", networkId: "net-1" }],
    });

    const cleanupNodeRuntime = vi.fn(async () => undefined);
    const result = await deleteNode(lab.id, "node-1", { cleanupNodeRuntime });

    expect(result?.document.nodes).toHaveLength(0);
    expect(result?.document.attachments).toHaveLength(0);
    expect(cleanupNodeRuntime).toHaveBeenCalledWith(lab.id, "node-1");
    expect((await getLab(lab.id))?.document.nodes).toHaveLength(0);
  });
});
