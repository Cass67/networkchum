import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { guessDeviceRoleIcon } from "./deviceRoleIcon.js";
import { TemplateRegistry } from "./templateRegistry.js";

let tempDataDir = "";

beforeEach(async () => {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-role-"));
  process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
});

afterEach(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = "";
  }
});

describe("guessDeviceRoleIcon", () => {
  it("classifies common device names deterministically", () => {
    expect(
      guessDeviceRoleIcon({
        runtime: "qemu",
        name: "Mgmt Network",
        vendor: "NetworkChum",
      }),
    ).toBe("cloud");

    expect(
      guessDeviceRoleIcon({
        runtime: "qemu",
        name: "Cisco ASAv 9.18",
        vendor: "Cisco",
      }),
    ).toBe("firewall");

    expect(
      guessDeviceRoleIcon({
        runtime: "qemu",
        name: "NX-OSv 9000",
        vendor: "Cisco",
      }),
    ).toBe("switch");

    expect(
      guessDeviceRoleIcon({
        runtime: "qemu",
        name: "CSR1000v",
        vendor: "Cisco",
      }),
    ).toBe("router");

    expect(
      guessDeviceRoleIcon({
        runtime: "container",
        name: "Alpine Container",
        vendor: "Linux",
      }),
    ).toBe("host");

    expect(
      guessDeviceRoleIcon({
        runtime: "qemu",
        name: "Windows Desktop",
        vendor: "Microsoft",
      }),
    ).toBe("client");

    expect(
      guessDeviceRoleIcon({
        runtime: "qemu",
        name: "Mystery Appliance",
        vendor: "Acme",
      }),
    ).toBe("router");
  });
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
