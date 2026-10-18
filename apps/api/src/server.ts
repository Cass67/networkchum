import { execFile } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { resolveListenHost } from "@networkchum/shared";

import { buildApp } from "./app.js";
import { scanImages } from "./images/scanImages.js";
import { detectContainerEngine } from "./runtime/container/containerRuntimeService.js";
import { getNetworkBackend } from "./runtime/hostCapabilities.js";
import { syncSocketTopology } from "./runtime/syncSocketTopology.js";
import { getDataDir, getImagesDir } from "./storagePaths.js";

const execFileAsync = promisify(execFile);
const CAP_NET_ADMIN = 12;

async function runCommand(
  command: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args);
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Command failed",
    };
  }
}

function resolveOnPath(command: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not executable here; keep looking
    }
  }
  return null;
}

function hasBinaryOnPath(command: string): Promise<boolean> {
  return Promise.resolve(resolveOnPath(command) !== null);
}

async function logContainerEngine(): Promise<void> {
  const engine = await detectContainerEngine(hasBinaryOnPath, runCommand);
  if (!engine) {
    console.log(
      "[startup] containers: neither podman nor docker found; container nodes will fail to start",
    );
    return;
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid === 0) {
    console.log(
      `[startup] containers: ${engine} as root (containers go to root's store; see them with 'sudo ${engine} ps -a')`,
    );
  } else {
    console.log(
      `[startup] containers: ${engine} as uid ${uid} (containers go to this user's store)`,
    );
  }
}

function hasEffectiveCapability(bit: number): boolean {
  try {
    const status = readFileSync("/proc/self/status", "utf8");
    const match = status.match(/^CapEff:\s*([0-9a-fA-F]+)/m);
    if (!match?.[1]) {
      return false;
    }
    return (BigInt(`0x${match[1]}`) & (1n << BigInt(bit))) !== 0n;
  } catch {
    return false;
  }
}

function logNetworking(): Promise<void> {
  const backend = getNetworkBackend();
  if (backend !== "tap") {
    console.log(`[startup] networking: ${backend} backend`);
    return Promise.resolve();
  }
  return logTapCapability();
}

async function logTapCapability(): Promise<void> {
  if (process.env.NETWORKCHUM_IP_SUDO === "1") {
    console.log("[startup] networking: tap backend, CAP_NET_ADMIN via sudo ip");
    return;
  }

  if (hasEffectiveCapability(CAP_NET_ADMIN)) {
    console.log("[startup] networking: tap backend, CAP_NET_ADMIN present");
    return;
  }

  const ipPath = resolveOnPath("ip");
  if (ipPath) {
    const result = await runCommand("getcap", [ipPath]);
    if (result.ok && /cap_net_admin/i.test(result.stdout)) {
      console.log(
        "[startup] networking: tap backend, CAP_NET_ADMIN via ip binary (setcap)",
      );
      return;
    }
  }

  console.log(
    "[startup] networking: tap backend, CAP_NET_ADMIN missing (TAP/bridge labs will fail; run ./start.sh install-service)",
  );
}

function describeScanError(error: unknown, imagesDir: string): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT") {
      return `images directory not found (${imagesDir})`;
    }
    if (typeof code === "string") {
      return `${code} reading ${imagesDir}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function logImageScan(
  images: Awaited<ReturnType<typeof scanImages>>,
  imagesDir: string,
): void {
  const boundCount = images.filter((image) => image.templateId).length;
  console.log(
    `[startup] scanned ${images.length} image(s) from ${imagesDir} (${boundCount} bound to a template)`,
  );
  if (images.length === 0) {
    console.log(
      "[startup] no .qcow2 images found; the device catalog will only show container and cloud templates",
    );
    console.log(
      `[startup] add VM images to ${imagesDir}, or set NETWORKCHUM_DATA_DIR to a data dir that contains images/*.qcow2`,
    );
  }
}

const app = buildApp({ runtime: { runCommand } });

app
  .listen({
    host: resolveListenHost(process.env.NETWORKCHUM_BIND_MODE),
    port: 4000,
  })
  .then(async () => {
    const dataDir = getDataDir();
    const imagesDir = getImagesDir();

    console.log(`[startup] data dir:   ${dataDir}`);
    console.log(`[startup] images dir: ${imagesDir}`);

    await logContainerEngine();
    await logNetworking();

    const socketTopology = await syncSocketTopology();
    if (socketTopology.nics > 0) {
      console.log(
        `[startup] restored socket topology for ${socketTopology.qemuNodes} running qemu node(s) across ${socketTopology.attachments} attachment(s)`,
      );
    }

    try {
      logImageScan(await scanImages(imagesDir), imagesDir);
    } catch (error) {
      console.log(
        `[startup] image scan skipped: ${describeScanError(error, imagesDir)}`,
      );
      console.log(
        "[startup] set NETWORKCHUM_DATA_DIR to a data dir containing images/*.qcow2 to see VM devices; run ./start.sh doctor for details",
      );
    }
  })
  .catch((error) => {
    app.log.error(error);
    process.exitCode = 1;
  });
