import { afterEach, describe, expect, it } from "vitest";

import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { reconcileRuntimeStates } from "./reconcileRuntimeStates.js";
import { listRuntimeStates, upsertRuntimeState } from "./runtimeStateStore.js";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("reconcileRuntimeStates", () => {
  it("keeps running macos management cloud states running even when externalId is null", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-rt-"));
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    await upsertRuntimeState({
      labId: "lab-1",
      nodeId: "cloud-a",
      status: "running",
      runtime: "cloud",
      accelerationMode: null,
      externalId: null,
      cloudBackend: "macos-management",
      commandPreview: [],
      updatedAt: "2026-04-11T00:00:00.000Z",
    });

    const reconciled = await reconcileRuntimeStates(undefined, async () => ({
      ok: false,
      stdout: "",
      stderr: "should not probe containers for macos management clouds",
    }));

    const state = reconciled.find((entry) => entry.nodeId === "cloud-a");
    expect(state?.status).toBe("running");

    const persisted = (await listRuntimeStates()).find(
      (entry) => entry.nodeId === "cloud-a",
    );
    expect(persisted?.status).toBe("running");
  });

  it("stops stale podman-backed container runtime states", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-rt-"));
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    await upsertRuntimeState({
      labId: "lab-1",
      nodeId: "container-a",
      status: "running",
      runtime: "container",
      accelerationMode: null,
      externalId: "container-a",
      connectCommand: ["podman", "exec", "-it", "container-a", "sh"],
      message: null,
      commandPreview: ["podman", "run", "-d", "--name", "container-a"],
      updatedAt: "2026-04-13T00:00:00.000Z",
    });

    const calls: string[] = [];
    const reconciled = await reconcileRuntimeStates(
      undefined,
      async (command) => {
        calls.push(command);
        return {
          ok: false,
          stdout: "",
          stderr: "Error: no such container",
        };
      },
    );

    const state = reconciled.find((entry) => entry.nodeId === "container-a");
    expect(calls).toEqual(["podman"]);
    expect(state?.status).toBe("stopped");
    expect(state?.message).toContain("Container is not running");

    const persisted = (await listRuntimeStates()).find(
      (entry) => entry.nodeId === "container-a",
    );
    expect(persisted?.status).toBe("stopped");
  });
});
