import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  appendRunningConfigBackupRecord,
  listRunningConfigBackupRecords,
} from "./runningConfigBackupStore.js";
import { coordinateRunningConfigBackup } from "./runningConfigBackup.js";
import type { RunningConfigBackupAdapter } from "./runningConfigBackupAdapters.js";

let tempDataDir = "";

beforeEach(async () => {
  tempDataDir = await mkdtemp(
    path.join(os.tmpdir(), "networkchum-running-config-"),
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

describe("runningConfigBackupStore", () => {
  it("writes and lists backup records", async () => {
    const labId = "lab-1";
    const nodeId = "node-1";
    const now = new Date().toISOString();

    await appendRunningConfigBackupRecord({
      id: "record-1",
      labId,
      nodeId,
      status: "captured",
      source: "boot backup",
      createdAt: now,
      config: "config 1",
    });

    await appendRunningConfigBackupRecord({
      id: "record-2",
      labId,
      nodeId,
      status: "failed",
      source: "boot backup",
      createdAt: now,
      error: "boom",
    });

    const records = await listRunningConfigBackupRecords(labId, nodeId);

    expect(records.map((record) => record.id)).toEqual([
      "record-1",
      "record-2",
    ]);
  });
});

describe("coordinateRunningConfigBackup", () => {
  const labId = "lab-1";
  const nodeId = "node-1";
  const source = "boot backup";

  it("records failed when adapter supports throws", async () => {
    const adapters: RunningConfigBackupAdapter[] = [
      {
        supports: async () => {
          throw new Error("boom support");
        },
        capture: async () => "not reached",
      },
    ];

    await coordinateRunningConfigBackup({
      labId,
      nodeId,
      source,
      adapters,
    });

    const records = await listRunningConfigBackupRecords(labId, nodeId);

    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("failed");
    expect(records[0].error).toContain("boom support");
  });

  it("records unsupported when no adapter supports the node", async () => {
    await coordinateRunningConfigBackup({
      labId,
      nodeId,
      source,
      adapters: [],
    });

    const records = await listRunningConfigBackupRecords(labId, nodeId);

    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("unsupported");
  });

  it("records captured when adapter returns config text", async () => {
    const adapters: RunningConfigBackupAdapter[] = [
      {
        supports: async () => true,
        capture: async () => "captured-config",
      },
    ];

    await coordinateRunningConfigBackup({
      labId,
      nodeId,
      source,
      adapters,
    });

    const records = await listRunningConfigBackupRecords(labId, nodeId);

    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("captured");
    expect(records[0].config).toBe("captured-config");
  });

  it("records failed when adapter throws during capture", async () => {
    const adapters: RunningConfigBackupAdapter[] = [
      {
        supports: async () => true,
        capture: async () => {
          throw new Error("boom");
        },
      },
    ];

    await coordinateRunningConfigBackup({
      labId,
      nodeId,
      source,
      adapters,
    });

    const records = await listRunningConfigBackupRecords(labId, nodeId);

    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("failed");
    expect(records[0].error).toContain("boom");
  });
});

describe("runningConfigBackupStore error handling", () => {
  it("rejects when existing backup file contains invalid JSON", async () => {
    const labId = "lab-error";
    const nodeId = "node-error";
    const dir = path.join(
      process.env.NETWORKCHUM_DATA_DIR ?? "",
      "running-config-backups",
      labId,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${nodeId}.json`), "not-json");

    await expect(
      listRunningConfigBackupRecords(labId, nodeId),
    ).rejects.toThrow();
  });
});
