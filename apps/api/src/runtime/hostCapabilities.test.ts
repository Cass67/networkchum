import { describe, expect, it } from "vitest";

import {
  detectAccelerationMode,
  getNetworkBackend,
  getPlatform,
} from "./hostCapabilities.js";

describe("detectAccelerationMode", () => {
  it("reports none when no acceleration devices are available", async () => {
    const result = await detectAccelerationMode(async () => false, "linux");

    expect(result.mode).toBe("none");
    expect(result.available).toBe(false);
  });

  it("prefers kvm when /dev/kvm is available", async () => {
    const result = await detectAccelerationMode(
      async (devicePath) => devicePath === "/dev/kvm",
      "linux",
    );

    expect(result.mode).toBe("kvm");
    expect(result.available).toBe(true);
  });

  it("reports hvf on macos when available", async () => {
    const result = await detectAccelerationMode(
      async () => false,
      "macos",
      async () => ({
        ok: true,
        stdout: "Accelerators supported: tcg hvf\n",
        stderr: "",
      }),
      async () => "qemu-system-x86_64",
    );

    expect(result.mode).toBe("hvf");
    expect(result.available).toBe(true);
    expect(result.message).toContain("HVF");
  });

  it("reports tcg on macos when hvf is not available", async () => {
    const result = await detectAccelerationMode(
      async () => false,
      "macos",
      async () => ({
        ok: true,
        stdout: "Accelerators supported: tcg\n",
        stderr: "",
      }),
      async () => "qemu-system-x86_64",
    );

    expect(result.mode).toBe("tcg");
    expect(result.available).toBe(true);
    expect(result.message).toContain("Apple Silicon");
  });

  it("reports none on macos when no qemu binary is available", async () => {
    const result = await detectAccelerationMode(
      async () => false,
      "macos",
      async () => ({
        ok: false,
        stdout: "",
        stderr: "not found",
      }),
      async () => null,
    );

    expect(result.mode).toBe("none");
    expect(result.available).toBe(false);
    expect(result.message).toContain("QEMU");
  });
});

describe("getPlatform", () => {
  it("returns a valid platform string", () => {
    const platform = getPlatform();
    expect(["linux", "macos", "other"]).toContain(platform);
  });
});

describe("getNetworkBackend", () => {
  it("returns tap or socket", () => {
    const backend = getNetworkBackend();
    expect(["tap", "socket"]).toContain(backend);
  });
});
