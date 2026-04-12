import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const QEMU_BINARY_CANDIDATES = [
  "qemu-system-x86_64",
  "qemu-kvm",
  "/usr/libexec/qemu-kvm",
] as const;

export type BinaryProbe = (candidate: string) => Promise<boolean>;

async function defaultBinaryProbe(candidate: string): Promise<boolean> {
  if (candidate.startsWith("/")) {
    try {
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  try {
    const result = await execFileAsync("which", [candidate]);
    return result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function resolveQemuBinary(
  probe: BinaryProbe = defaultBinaryProbe,
  envOverride = process.env.NETWORKCHUM_QEMU_BINARY,
): Promise<string | null> {
  const candidates = envOverride
    ? [envOverride, ...QEMU_BINARY_CANDIDATES]
    : [...QEMU_BINARY_CANDIDATES];

  for (const candidate of candidates) {
    if (await probe(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function isQemuProcessCommandLine(commandLine: string): boolean {
  return QEMU_BINARY_CANDIDATES.some((candidate) =>
    commandLine.includes(candidate),
  );
}
