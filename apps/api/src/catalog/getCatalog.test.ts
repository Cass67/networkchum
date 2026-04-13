import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveImages } from "../images/imageStore.js";
import { getCatalog } from "./getCatalog.js";

let tempDataDir = "";

beforeEach(async () => {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-catalog-"));
  process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
});

afterEach(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = "";
  }
});

describe("getCatalog", () => {
  it("returns built-in container templates and bound VM images", async () => {
    await saveImages([
      {
        id: "img-1",
        name: "asr1000.qcow2",
        path: "/tmp/asr1000.qcow2",
        format: "qcow2",
        sizeBytes: 100,
        updatedAt: new Date().toISOString(),
        templateId: "cisco-asr",
        suggestedTemplateId: "cisco-asr",
        source: "scan",
        catalogState: "active",
      },
    ]);

    const entries = await getCatalog();

    expect(
      entries.some(
        (entry) =>
          entry.template.id === "cisco-asr" && entry.image?.id === "img-1",
      ),
    ).toBe(true);
    expect(
      entries.some(
        (entry) =>
          entry.template.id === "linux-alpine-container" &&
          entry.image === null,
      ),
    ).toBe(true);
    expect(
      entries.some(
        (entry) => entry.template.id === "cisco-iosv" && entry.image === null,
      ),
    ).toBe(false);
  });

  it("returns cloud template as built-in entry", async () => {
    const entries = await getCatalog();

    expect(
      entries.some(
        (entry) =>
          entry.template.id === "cloud" &&
          entry.source === "built-in" &&
          entry.image === null &&
          entry.template.configSchema.interfaceCount.default === 10,
      ),
    ).toBe(true);
  });
});
