import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scanImages } from "./scanImages.js";

const tempDirs: string[] = [];

beforeEach(async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-data-"));
  tempDirs.push(dataDir);
  process.env.NETWORKCHUM_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("scanImages", () => {
  it("discovers qcow2 images and suggests templates", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-images-"),
    );
    tempDirs.push(tempDir);
    await writeFile(path.join(tempDir, "asr1000.qcow2"), "disk");

    const images = await scanImages(tempDir);

    expect(images).toHaveLength(1);
    expect(images[0]?.format).toBe("qcow2");
    expect(images[0]?.suggestedTemplateId).toBe("cisco-asr");
  });

  it("auto-binds recognized scanned images so they become addable catalog entries", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-images-"),
    );
    tempDirs.push(tempDir);
    await writeFile(path.join(tempDir, "veos-4.33.1.1F.qcow2"), "disk");

    const images = await scanImages(tempDir);

    expect(images).toHaveLength(1);
    expect(images[0]?.suggestedTemplateId).toBe("arista-veos");
    expect(images[0]?.templateId).toBe("arista-veos");
  });
});
