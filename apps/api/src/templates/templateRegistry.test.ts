import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TemplateRegistry } from "./templateRegistry.js";
import { saveUserContainerTemplate } from "../runtime/container/userContainerTemplateStore.js";

let tempDataDir = "";
let priorDataDir: string | undefined;

beforeEach(async () => {
  priorDataDir = process.env.NETWORKCHUM_DATA_DIR;
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-registry-"));
  process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
});

afterEach(async () => {
  if (priorDataDir === undefined) {
    delete process.env.NETWORKCHUM_DATA_DIR;
  } else {
    process.env.NETWORKCHUM_DATA_DIR = priorDataDir;
  }
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = "";
  }
  priorDataDir = undefined;
});

describe("TemplateRegistry overrides", () => {
  it("persists deviceRoleIcon updates through updateDefaults", () => {
    const registry = new TemplateRegistry();
    const base = registry.get("cisco-iosv");

    if (!base) {
      throw new Error("Missing template fixture");
    }

    const updated = registry.updateDefaults("cisco-iosv", {
      ramMb: base.configSchema.ramMb.default,
      vcpu: base.configSchema.vcpu.default,
      interfaceCount: base.configSchema.interfaceCount.default,
      deviceRoleIcon: "firewall",
    });

    expect(updated?.deviceRoleIcon).toBe("firewall");

    const refreshed = new TemplateRegistry().get("cisco-iosv");
    expect(refreshed?.deviceRoleIcon).toBe("firewall");
  });

  it("includes saved user container templates in registry listings", async () => {
    await saveUserContainerTemplate({
      id: "container-oraclelinux",
      runtime: "container",
      displayName: "Oracle Linux 9",
      vendor: "Oracle",
      deviceRoleIcon: "host",
      boot: {
        console: "serial",
        acceleration: "n/a",
      },
      configSchema: {
        ramMb: { default: 512, min: 128, max: 8192 },
        vcpu: { default: 1, min: 1, max: 4 },
        interfaceCount: { default: 1, min: 1, max: 4 },
      },
      container: {
        imageRef: "oraclelinux:9-slim",
        registry: "docker-hub",
        engine: "podman",
        defaultShell: "sh",
      },
    });

    const registry = new TemplateRegistry();
    const listed = registry.list();
    const saved = registry.get("container-oraclelinux");

    expect(
      listed.some((template) => template.id === "container-oraclelinux"),
    ).toBe(true);
    expect(saved?.container?.imageRef).toBe("oraclelinux:9-slim");
    expect(saved?.container?.engine).toBe("podman");
  });
});
