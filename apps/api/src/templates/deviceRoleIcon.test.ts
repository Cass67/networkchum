import { describe, expect, it } from "vitest";

import { guessDeviceRoleIcon } from "./deviceRoleIcon.js";

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
        name: "NX-OS Sandbox",
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
