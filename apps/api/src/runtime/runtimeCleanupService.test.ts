import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getNodeOverlayPath } from "../storagePaths.js";
import { cleanupNodeRuntime } from "./runtimeCleanupService.js";
import { listRuntimeStates, upsertRuntimeState } from "./runtimeStateStore.js";

let tempDataDir = "";

beforeEach(async () => {
  tempDataDir = await mkdtemp(
    path.join(os.tmpdir(), "networkchum-runtime-cleanup-"),
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

describe("cleanupNodeRuntime", () => {
  it("removes runtime state and overlay disk for a node", async () => {
    await upsertRuntimeState({
      labId: "lab-1",
      nodeId: "node-1",
      status: "running",
      runtime: "container",
      accelerationMode: null,
      externalId: "container-1",
      commandPreview: [],
      updatedAt: new Date().toISOString(),
    });

    const overlayPath = getNodeOverlayPath("lab-1", "node-1");
    await mkdir(path.dirname(overlayPath), { recursive: true });
    await writeFile(overlayPath, "overlay");

    const powerOff = vi.fn(async () => ({}));
    await cleanupNodeRuntime("lab-1", "node-1", { powerOff });

    expect(powerOff).toHaveBeenCalledWith("lab-1", "node-1");
    expect(await listRuntimeStates("lab-1")).toHaveLength(0);
    await expect(
      access(getNodeOverlayPath("lab-1", "node-1")),
    ).rejects.toThrow();
  });
});
