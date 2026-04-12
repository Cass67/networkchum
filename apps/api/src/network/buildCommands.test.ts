import { describe, expect, it } from "vitest";

import { buildCommand } from "./buildCommands.js";
import type { NetworkOperation } from "./types.js";

describe("buildCommand", () => {
  it("creates a bridge", () => {
    const op: NetworkOperation = {
      kind: "create-bridge",
      bridgeName: "nc-br-net1",
    };
    expect(buildCommand(op)).toEqual([
      "ip",
      "link",
      "add",
      "name",
      "nc-br-net1",
      "type",
      "bridge",
    ]);
  });

  it("deletes a bridge", () => {
    const op: NetworkOperation = {
      kind: "delete-bridge",
      bridgeName: "nc-br-net1",
    };
    expect(buildCommand(op)).toEqual([
      "ip",
      "link",
      "del",
      "name",
      "nc-br-net1",
    ]);
  });

  it("creates a tap device", () => {
    const op: NetworkOperation = {
      kind: "create-tap",
      tapName: "tap-lab1-node1-0",
    };
    expect(buildCommand(op)).toEqual(
      expect.arrayContaining([
        "ip",
        "tuntap",
        "add",
        "dev",
        "tap-lab1-node1-0",
        "mode",
        "tap",
        "user",
      ]),
    );
  });

  it("deletes a tap device", () => {
    const op: NetworkOperation = {
      kind: "delete-tap",
      tapName: "tap-lab1-node1-0",
    };
    expect(buildCommand(op)).toEqual([
      "ip",
      "link",
      "del",
      "dev",
      "tap-lab1-node1-0",
    ]);
  });

  it("attaches an interface to a bridge", () => {
    const op: NetworkOperation = {
      kind: "attach-to-bridge",
      interfaceName: "tap-lab1-node1-0",
      bridgeName: "nc-br-net1",
    };
    expect(buildCommand(op)).toEqual([
      "ip",
      "link",
      "set",
      "dev",
      "tap-lab1-node1-0",
      "master",
      "nc-br-net1",
    ]);
  });

  it("detaches an interface from a bridge", () => {
    const op: NetworkOperation = {
      kind: "detach-from-bridge",
      interfaceName: "tap-lab1-node1-0",
      bridgeName: "nc-br-net1",
    };
    expect(buildCommand(op)).toEqual([
      "ip",
      "link",
      "set",
      "dev",
      "tap-lab1-node1-0",
      "nomaster",
    ]);
  });

  it("creates a veth pair", () => {
    const op: NetworkOperation = {
      kind: "create-veth-pair",
      vethLeft: "veth-a",
      vethRight: "veth-b",
    };
    expect(buildCommand(op)).toEqual([
      "ip",
      "link",
      "add",
      "name",
      "veth-a",
      "type",
      "veth",
      "peer",
      "name",
      "veth-b",
    ]);
  });

  it("deletes a veth", () => {
    const op: NetworkOperation = { kind: "delete-veth", vethName: "veth-a" };
    expect(buildCommand(op)).toEqual(["ip", "link", "del", "dev", "veth-a"]);
  });

  it("sets an interface up", () => {
    const op: NetworkOperation = {
      kind: "set-interface-up",
      interfaceName: "tap-lab1-node1-0",
    };
    expect(buildCommand(op)).toEqual([
      "ip",
      "link",
      "set",
      "dev",
      "tap-lab1-node1-0",
      "up",
    ]);
  });

  it("sets an interface down", () => {
    const op: NetworkOperation = {
      kind: "set-interface-down",
      interfaceName: "tap-lab1-node1-0",
    };
    expect(buildCommand(op)).toEqual([
      "ip",
      "link",
      "set",
      "dev",
      "tap-lab1-node1-0",
      "down",
    ]);
  });
});
