import { describe, expect, it } from "vitest";

import { planManagementBridgeUplinkCommands } from "./managementUplink.js";

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
});
