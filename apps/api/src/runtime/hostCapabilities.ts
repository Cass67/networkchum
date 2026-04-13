import { access } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";

import { resolveQemuBinary } from "./qemu/resolveQemuBinary.js";

type AccessCheck = (devicePath: string) => Promise<boolean>;
type RunCommand = (
  command: string,
  args: string[],
) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

async function defaultAccessCheck(devicePath: string): Promise<boolean> {
  try {
    await access(devicePath, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export type Platform = "linux" | "macos" | "other";

export function getPlatform(): Platform {
  const platform = os.platform();
  if (platform === "linux") return "linux";
  if (platform === "darwin") return "macos";
  return "other";
}

export function getCloudManagementCapability(
  platform: Platform = getPlatform(),
) {
  const networkBackend = getNetworkBackendForPlatform(platform);
  if (platform === "linux") {
    return {
      platform,
      networkBackend,
      managementCloudMode: "linux-bridge" as const,
    };
  }

  if (platform === "macos") {
    return {
      platform,
      networkBackend,
      managementCloudMode: "macos-host-only" as const,
    };
  }

  return {
    platform,
    networkBackend,
    managementCloudMode: "unsupported" as const,
  };
}

export async function detectAccelerationMode(
  accessCheck: AccessCheck = defaultAccessCheck,
  platform: "linux" | "macos" | "other" = getPlatform(),
  runCommand?: RunCommand,
  resolveBinary: () => Promise<string | null> = resolveQemuBinary,
) {
  if (platform === "linux" && (await accessCheck("/dev/kvm"))) {
    return { mode: "kvm", available: true, message: null };
  }

  if (platform === "macos") {
    const qemuBinary = await resolveBinary();
    if (!qemuBinary) {
      return {
        mode: "none",
        available: false,
        message:
          "QEMU is not installed on this host. Install QEMU before starting VM nodes.",
      };
    }

    const exec =
      runCommand ??
      (async (cmd, args) => {
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const result = await promisify(execFile)(cmd, args);
          return { ok: true, stdout: result.stdout, stderr: result.stderr };
        } catch {
          return { ok: false, stdout: "", stderr: "" };
        }
      });
    const result = await exec(qemuBinary, ["-accel", "help"]);
    const output = result.stdout + result.stderr;
    if (output.includes("hvf")) {
      return {
        mode: "hvf",
        available: true,
        message:
          "Using HVF acceleration (macOS). TAP networking is not available — socket networking will be used.",
      };
    }
    return {
      mode: "tcg",
      available: true,
      message:
        "Running x86 QEMU on Apple Silicon with software emulation (TCG). VMs will be very slow. For production QEMU workloads, run NetworkChum inside a Linux VM (UTM, Lima, or similar) with KVM support.",
    };
  }

  return {
    mode: "none",
    available: false,
    message:
      "No supported hardware acceleration device is available on this host.",
  };
}

export function getNetworkBackendForPlatform(
  platform: Platform,
): "tap" | "socket" {
  return platform === "linux" ? "tap" : "socket";
}

export function getNetworkBackend(): "tap" | "socket" {
  return getNetworkBackendForPlatform(getPlatform());
}
