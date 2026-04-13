import { afterEach, describe, expect, it } from "vitest";

import {
  ensureManagementBridgeUplink,
  planManagementBridgeUplinkCommands,
} from "./managementUplink.js";

afterEach(() => {
  delete process.env.NETWORKCHUM_BIND_MODE;
  delete process.env.NETWORKCHUM_MANAGEMENT_UPLINK;
});

describe("managementUplink", () => {
  it("migrates the default uplink IPv4 and route onto nc-mgmt", () => {
    const commands = planManagementBridgeUplinkCommands({
      bridgeName: "nc-mgmt",
      uplinkName: "eno1",
      bridgeLink: { ifname: "nc-mgmt", address: "02:00:00:00:00:01" },
      bridgeAddresses: [],
      uplinkLink: { ifname: "eno1", address: "aa:bb:cc:dd:ee:ff" },
      uplinkAddresses: [
        {
          family: "inet",
          local: "192.168.2.57",
          prefixlen: 24,
          scope: "global",
        },
      ],
      defaultRoutes: [
        {
          dst: "default",
          gateway: "192.168.2.254",
          dev: "eno1",
        },
      ],
    });

    expect(commands).toEqual([
      ["ip", "link", "set", "dev", "nc-mgmt", "address", "aa:bb:cc:dd:ee:ff"],
      ["ip", "link", "set", "dev", "nc-mgmt", "up"],
      ["ip", "addr", "add", "192.168.2.57/24", "dev", "nc-mgmt"],
      ["ip", "link", "set", "dev", "eno1", "master", "nc-mgmt"],
      ["ip", "link", "set", "dev", "eno1", "up"],
      ["ip", "addr", "del", "192.168.2.57/24", "dev", "eno1"],
      [
        "ip",
        "route",
        "replace",
        "default",
        "via",
        "192.168.2.254",
        "dev",
        "nc-mgmt",
      ],
    ]);
  });

  it("does nothing when the uplink is already under nc-mgmt and routes already point at the bridge", () => {
    const commands = planManagementBridgeUplinkCommands({
      bridgeName: "nc-mgmt",
      uplinkName: "eno1",
      bridgeLink: { ifname: "nc-mgmt", address: "aa:bb:cc:dd:ee:ff" },
      bridgeAddresses: [
        {
          family: "inet",
          local: "192.168.2.57",
          prefixlen: 24,
          scope: "global",
        },
      ],
      uplinkLink: {
        ifname: "eno1",
        address: "aa:bb:cc:dd:ee:ff",
        master: "nc-mgmt",
      },
      uplinkAddresses: [],
      defaultRoutes: [
        {
          dst: "default",
          gateway: "192.168.2.254",
          dev: "nc-mgmt",
        },
      ],
    });

    expect(commands).toEqual([]);
  });

  it("keeps succeeding after the uplink has already been migrated onto nc-mgmt", async () => {
    process.env.NETWORKCHUM_BIND_MODE = "lan";

    const commands: string[][] = [];
    const result = await ensureManagementBridgeUplink(
      async (command, args) => {
        commands.push([command, ...args]);
        const invocation = `${command} ${args.join(" ")}`;

        switch (invocation) {
          case "ip -json route show default":
            return {
              ok: true,
              stdout: JSON.stringify([
                {
                  dst: "default",
                  gateway: "192.168.2.254",
                  dev: "nc-mgmt",
                },
              ]),
              stderr: "",
            };
          case "ip -json link show master nc-mgmt":
            return {
              ok: true,
              stdout: JSON.stringify([
                { ifname: "tap-c123-odea-0", master: "nc-mgmt" },
                {
                  ifname: "eno1",
                  address: "aa:bb:cc:dd:ee:ff",
                  master: "nc-mgmt",
                },
              ]),
              stderr: "",
            };
          case "ip -json link show dev nc-mgmt":
            return {
              ok: true,
              stdout: JSON.stringify([
                { ifname: "nc-mgmt", address: "aa:bb:cc:dd:ee:ff" },
              ]),
              stderr: "",
            };
          case "ip -json addr show dev nc-mgmt":
            return {
              ok: true,
              stdout: JSON.stringify([
                {
                  addr_info: [
                    {
                      family: "inet",
                      local: "192.168.2.57",
                      prefixlen: 24,
                      scope: "global",
                    },
                  ],
                },
              ]),
              stderr: "",
            };
          case "ip -json link show dev eno1":
            return {
              ok: true,
              stdout: JSON.stringify([
                {
                  ifname: "eno1",
                  address: "aa:bb:cc:dd:ee:ff",
                  master: "nc-mgmt",
                },
              ]),
              stderr: "",
            };
          case "ip -json addr show dev eno1":
            return {
              ok: true,
              stdout: JSON.stringify([{ addr_info: [] }]),
              stderr: "",
            };
          default:
            return { ok: true, stdout: "", stderr: "" };
        }
      },
      new Map([["net-1", "nc-mgmt"]]),
    );

    expect(result).toEqual({ ok: true });
    expect(commands).not.toContainEqual([
      "ip",
      "link",
      "set",
      "dev",
      "eno1",
      "master",
      "nc-mgmt",
    ]);
  });
});
