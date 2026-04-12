import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveImages } from "./imageStore.js";
import { resolveNodeImagePath } from "./resolveNodeImage.js";

let tempDataDir = "";

beforeEach(async () => {
  tempDataDir = await mkdtemp(
    path.join(os.tmpdir(), "networkchum-resolve-image-"),
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

describe("resolveNodeImagePath", () => {
  it("resolves a node image by image record id", async () => {
    await saveImages([
      {
        id: "img-1",
        name: "csr1000v.qcow2",
        path: "/tmp/csr1000v.qcow2",
        format: "qcow2",
        sizeBytes: 100,
        updatedAt: new Date().toISOString(),
        templateId: "cisco-asr",
        suggestedTemplateId: "cisco-asr",
        source: "upload",
        catalogState: "active",
      },
    ]);

    await expect(resolveNodeImagePath("img-1")).resolves.toBe(
      "/tmp/csr1000v.qcow2",
    );
  });

  it("falls back to legacy absolute paths when migrating older labs", async () => {
    await expect(resolveNodeImagePath("/tmp/csr1000v.qcow2")).resolves.toBe(
      "/tmp/csr1000v.qcow2",
    );
  });
});
