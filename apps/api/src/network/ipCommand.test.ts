import { afterEach, describe, expect, it } from "vitest";

import { ipCommand } from "./ipCommand.js";

describe("ipCommand", () => {
  const prior = process.env.NETWORKCHUM_IP_SUDO;

  afterEach(() => {
    if (prior === undefined) {
      delete process.env.NETWORKCHUM_IP_SUDO;
    } else {
      process.env.NETWORKCHUM_IP_SUDO = prior;
    }
  });

  it("runs ip directly by default", () => {
    delete process.env.NETWORKCHUM_IP_SUDO;
    expect(ipCommand(["link", "show"])).toEqual(["ip", "link", "show"]);
  });

  it("routes ip through sudo when NETWORKCHUM_IP_SUDO=1", () => {
    process.env.NETWORKCHUM_IP_SUDO = "1";
    delete process.env.NETWORKCHUM_IP_PATH;
    expect(ipCommand(["tuntap", "add", "dev", "tap0", "mode", "tap"])).toEqual([
      "sudo",
      "-n",
      "ip",
      "tuntap",
      "add",
      "dev",
      "tap0",
      "mode",
      "tap",
    ]);
  });

  it("uses an absolute ip path when NETWORKCHUM_IP_PATH is set", () => {
    process.env.NETWORKCHUM_IP_SUDO = "1";
    process.env.NETWORKCHUM_IP_PATH = "/usr/sbin/ip";
    expect(ipCommand(["link", "show"])).toEqual([
      "sudo",
      "-n",
      "/usr/sbin/ip",
      "link",
      "show",
    ]);
    delete process.env.NETWORKCHUM_IP_PATH;
  });
});
