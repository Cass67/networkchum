import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TemplateRegistry } from "./templateRegistry.js";

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
});
