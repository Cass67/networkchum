import { access, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { createImageService } from "./imageService.js";

let dataDir = "";

afterEach(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
    dataDir = "";
  }
});

describe("createImageService", () => {
  it("removes an image from the catalog without deleting the stored file", async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "networkchum-image-service-"));
    process.env.NETWORKCHUM_DATA_DIR = dataDir;

    const service = createImageService();
    const uploaded = await service.uploadImage({
      fileName: "csr1000v.qcow2",
      content: Buffer.from("qcow2"),
    });

    const removed = await service.removeImageFromCatalog(uploaded.id);

    expect(removed?.catalogState).toBe("removed");
    await expect(access(uploaded.path)).resolves.toBeUndefined();
  });

  it("suggests a template from the uploaded file name", async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "networkchum-image-service-"));
    process.env.NETWORKCHUM_DATA_DIR = dataDir;

    const service = createImageService();
    const uploaded = await service.uploadImage({
      fileName: "asr-1.qcow2",
      content: Buffer.from("qcow2"),
    });

    expect(uploaded.suggestedTemplateId).toBe("cisco-asr");
  });

  it("restores a removed image to the active catalog when it is bound", async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "networkchum-image-service-"));
    process.env.NETWORKCHUM_DATA_DIR = dataDir;

    const service = createImageService();
    const uploaded = await service.uploadImage({
      fileName: "csr1000v.qcow2",
      content: Buffer.from("qcow2"),
    });
    await service.removeImageFromCatalog(uploaded.id);

    const bound = await service.bindImageToTemplate(uploaded.id, "cisco-asr");

    expect(bound?.catalogState).toBe("active");
    expect(bound?.templateId).toBe("cisco-asr");
  });
});
