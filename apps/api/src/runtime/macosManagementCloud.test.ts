import { describe, expect, it } from "vitest";

import {
  MACOS_MANAGEMENT_SUBNET,
  MACOS_MANAGEMENT_UNAVAILABLE_MESSAGE,
  buildMacOsManagementUnavailableMessage,
  getMacOsManagementSubnet,
} from "./macosManagementCloud.js";

describe("macOS management cloud helpers", () => {
  it("provides the fixed management subnet metadata", () => {
    expect(getMacOsManagementSubnet()).toBe(MACOS_MANAGEMENT_SUBNET);
  });

  it("reports an unavailable message that mentions the host-only management backend", () => {
    const message = buildMacOsManagementUnavailableMessage();

    expect(message).toBe(MACOS_MANAGEMENT_UNAVAILABLE_MESSAGE);
    expect(message).toContain("unavailable");
  });
});
