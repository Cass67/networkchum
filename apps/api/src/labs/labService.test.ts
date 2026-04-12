import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLab, getLab, updateLabDocument } from "./labStore.js";
import { deleteLab } from "./labService.js";

let tempDataDir = "";

beforeEach(async () => {
  tempDataDir = await mkdtemp(
    path.join(os.tmpdir(), "networkchum-lab-service-"),
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

describe("deleteLab", () => {
  it("cleans up each node runtime before removing the lab", async () => {
    const lab = await createLab("Service Lab");
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
          interfaces: [],
        },
      ],
    });

    const cleanupNodeRuntime = vi.fn(async () => undefined);
    const result = await deleteLab(lab.id, { cleanupNodeRuntime });

    expect(result).toEqual({ labId: lab.id });
    expect(cleanupNodeRuntime).toHaveBeenCalledWith(lab.id, "node-1");
    expect(await getLab(lab.id)).toBeNull();
  });
});
