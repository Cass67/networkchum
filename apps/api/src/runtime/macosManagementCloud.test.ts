import { describe, expect, it } from "vitest";

import {
  buildMacOsManagementUnavailableMessage,
  getMacOsManagementSubnet,
} from "./macosManagementCloud.js";

describe("macOS management cloud helpers", () => {
  it("provides the fixed management subnet metadata", () => {
    expect(getMacOsManagementSubnet()).toEqual({
      subnetCidr: "172.31.255.0/24",
      hostIp: "172.31.255.1",
    });
  });

  it("reports an unavailable message that mentions the host-only management backend", () => {
    const message = buildMacOsManagementUnavailableMessage();

    expect(message).toContain("host-only management backend");
  });
});
