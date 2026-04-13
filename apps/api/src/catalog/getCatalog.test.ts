import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveImages } from "../images/imageStore.js";
import { saveUserContainerTemplate } from "../runtime/container/userContainerTemplateStore.js";
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

  it("includes saved user container templates in the devices catalog", async () => {
    await saveUserContainerTemplate({
      id: "user-container-oracle-linux-9",
      runtime: "container",
      displayName: "Oracle Linux 9",
      vendor: "Oraclelinux",
      deviceRoleIcon: "host",
      boot: {
        console: "serial",
        acceleration: "n/a",
      },
      configSchema: {
        ramMb: { default: 512, min: 128, max: 8192 },
        vcpu: { default: 1, min: 1, max: 4 },
        interfaceCount: { default: 1, min: 1, max: 8 },
      },
      container: {
        imageRef: "oraclelinux:9-slim",
        registry: "docker-hub",
        engine: "docker",
        defaultShell: "sh",
      },
    });

    const entries = await getCatalog();

    expect(
      entries.some(
        (entry) =>
          entry.template.id === "user-container-oracle-linux-9" &&
          entry.source === "built-in" &&
          entry.image === null,
      ),
    ).toBe(true);
  });
});
