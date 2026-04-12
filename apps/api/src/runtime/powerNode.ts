import { execFile, spawn } from "node:child_process";
import { access, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getLab } from "../labs/labStore.js";
import {
  buildDockerNetworkConnectCommand,
  buildDockerNetworkCreateCommand,
  buildDockerNetworkDisconnectCommand,
  dockerNetworkName,
  getNodeAttachmentsForContainer,
} from "../network/dockerNetworking.js";
import { buildCommand } from "../network/buildCommands.js";
import { reconcileTopology } from "../network/reconcileTopology.js";
import { buildContainerSpec } from "./container/buildContainerSpec.js";
import { resolveNodeImagePath } from "../images/resolveNodeImage.js";
import { buildQemuCommand, tapName } from "./qemu/buildQemuCommand.js";
import {
  isQemuProcessCommandLine,
  resolveQemuBinary,
} from "./qemu/resolveQemuBinary.js";
import { syncSocketTopology } from "./syncSocketTopology.js";
import { virtualSwitch } from "./virtualSwitch.js";
import { getNetworkBackend, getPlatform } from "./hostCapabilities.js";
import { listRuntimeStates, upsertRuntimeState } from "./runtimeStateStore.js";
import {
  getDataFile,
  getNodeConfigDrivePath,
  getNodeOverlayPath,
} from "../storagePaths.js";
import {
  injectCloudInit,
  injectCsr1000vVfat,
  injectIosvVfat,
  injectVeosFlash,
} from "./configInjectors.js";
import { TemplateRegistry } from "../templates/templateRegistry.js";

const execFileAsync = promisify(execFile);

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

type RuntimeDependencies = {
  runCommand?: (command: string, args: string[]) => Promise<CommandResult>;
  hasBinary?: (command: string) => Promise<boolean>;
  resolveQemuBinary?: () => Promise<string | null>;
  launchQemu?: (
    command: string[],
    serialPort: number,
  ) => Promise<{ ok: boolean; pid: number | null; stderr: string }>;
  findAvailablePort?: (startPort: number) => Promise<number>;
};

async function findRunningQemuForDisk(
  diskPath: string,
  runCommand: (command: string, args: string[]) => Promise<CommandResult>,
): Promise<{ pid: string; consolePort: number | null } | null> {
  const lockCheck = await runCommand("lsof", ["-t", diskPath]);
  if (!lockCheck.ok || !lockCheck.stdout.trim()) {
    return null;
  }

  const pid = lockCheck.stdout.trim().split(/\s+/)[0];
  if (!pid) {
    return null;
  }

  const psResult = await runCommand("ps", ["-p", pid, "-o", "command="]);
  const commandLine = `${psResult.stdout} ${psResult.stderr}`;
  if (!isQemuProcessCommandLine(commandLine)) {
    return null;
  }

  const serialMatch = commandLine.match(
    /-serial\s+tcp:127\.0\.0\.1:(\d+),server,nowait/,
  );
  return {
    pid,
    consolePort: serialMatch ? Number(serialMatch[1]) : null,
  };
}

async function defaultRunCommand(
  command: string,
  args: string[],
): Promise<CommandResult> {
  try {
    const result = await execFileAsync(command, args);
    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Command failed",
    };
  }
}

async function defaultHasBinary(command: string): Promise<boolean> {
  if (command.startsWith("/")) {
    try {
      await access(command);
      return true;
    } catch {
      return false;
    }
  }

  const result = await defaultRunCommand("which", [command]);
  return result.ok && result.stdout.trim().length > 0;
}

function runtimeName(labId: string, nodeId: string): string {
  return `networkchum-${labId}-${nodeId}`.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

async function findAvailablePort(startPort: number): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(startPort, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : startPort;
      server.close(() => resolve(port));
    });
    server.on("error", () => {
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

type PortProbe = (port: number) => Promise<boolean>;

async function defaultPortProbe(port: number): Promise<boolean> {
  const available = await findAvailablePort(port);
  return available === port;
}

// Find two consecutive free ports (serial + monitor).
export async function findAvailableQemuPortBase(
  startPort: number,
  probePort: PortProbe = defaultPortProbe,
): Promise<number> {
  for (let basePort = startPort; basePort < startPort + 1000; basePort += 1) {
    const [a, b] = await Promise.all([
      probePort(basePort),
      probePort(basePort + 1),
    ]);
    if (a && b) return basePort;
  }
  throw new Error("No available QEMU port block found");
}

// Find N consecutive free ports starting at startPort.
export async function findConsecutivePorts(
  startPort: number,
  count: number,
  probePort: PortProbe = defaultPortProbe,
): Promise<number> {
  for (let base = startPort; base < startPort + 2000; base += 1) {
    const available = await Promise.all(
      Array.from({ length: count }, (_, i) => probePort(base + i)),
    );
    if (available.every(Boolean)) return base;
  }
  throw new Error("No available NIC port block found");
}

async function launchQemu(
  command: string[],
  serialPort: number,
): Promise<{ ok: boolean; pid: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const fullCommand = [
      ...command,
      "-serial",
      `tcp:127.0.0.1:${serialPort},server,nowait`,
      "-monitor",
      `tcp:127.0.0.1:${serialPort + 1},server,nowait`,
      "-display",
      "none",
    ];
    console.log("[powerNode] launching QEMU:", fullCommand.join(" "));

    let stderr = "";
    let resolved = false;

    // Run QEMU detached so it survives the parent process but we keep the real PID.
    const child = spawn(fullCommand[0]!, fullCommand.slice(1), {
      stdio: ["ignore", "ignore", "pipe"],
      detached: true,
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      console.error("[powerNode] QEMU spawn error:", err.message);
      resolve({ ok: false, pid: null, stderr: err.message });
    });

    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      console.error(`[powerNode] QEMU exited early with code ${code}:`, stderr);
      resolve({
        ok: false,
        pid: null,
        stderr: stderr || `QEMU exited with code ${code}`,
      });
    });

    // If QEMU is still alive after 500ms it started successfully.
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.unref();
      console.log(
        `[powerNode] QEMU started (pid=${child.pid}, serial=127.0.0.1:${serialPort})`,
      );
      resolve({ ok: true, pid: child.pid ?? null, stderr });
    }, 500);
  });
}

export async function powerOnNode(
  labId: string,
  nodeId: string,
  dependencies: RuntimeDependencies = {},
) {
  const lab = await getLab(labId);
  if (!lab) {
    console.error(`[powerNode] lab ${labId} not found`);
    return null;
  }

  const node = lab.document.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    console.error(`[powerNode] node ${nodeId} not found in lab ${labId}`);
    return null;
  }

  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const hasBinary = dependencies.hasBinary ?? defaultHasBinary;
  const resolveBinary =
    dependencies.resolveQemuBinary ?? (() => resolveQemuBinary(hasBinary));
  const existingState = (await listRuntimeStates(labId)).find(
    (state) => state.nodeId === nodeId,
  );

  if (existingState?.status === "running") {
    if (existingState.runtime === "qemu") {
      await syncSocketTopology();
    }
    console.log(
      `[powerNode] node ${nodeId} in lab ${labId} is already running`,
    );
    return existingState;
  }

  if (node.runtime === "container") {
    const containerName = runtimeName(labId, nodeId);
    console.log(`[powerNode] starting container ${containerName}`);
    const attachments = getNodeAttachmentsForContainer(lab.document, nodeId);

    const networkIds = [...new Set(attachments.map((a) => a.networkId))];
    for (const networkId of networkIds) {
      const createCmd = buildDockerNetworkCreateCommand(networkId);
      await runCommand(createCmd[0]!, createCmd.slice(1));
    }

    const primaryNetwork = attachments[0]
      ? dockerNetworkName(attachments[0].networkId)
      : undefined;

    const spec = buildContainerSpec({
      nodeName: containerName,
      image: "alpine:latest",
      cpu: node.config.vcpu,
      memoryMb: node.config.ramMb,
      network: primaryNetwork,
    });
    console.log("[powerNode] docker command:", spec.command.join(" "));
    const result = await runCommand(spec.command[0]!, spec.command.slice(1));

    if (result.ok) {
      console.log(`[powerNode] container started: ${result.stdout.trim()}`);
      const containerId = result.stdout.trim() || containerName;
      for (let i = 1; i < attachments.length; i += 1) {
        const connectCmd = buildDockerNetworkConnectCommand(
          attachments[i]!.networkId,
          containerId,
        );
        await runCommand(connectCmd[0]!, connectCmd.slice(1));
      }
    } else {
      console.error(`[powerNode] container failed: ${result.stderr}`);
    }

    const state = {
      labId,
      nodeId,
      status: result.ok ? ("running" as const) : ("failed" as const),
      runtime: node.runtime,
      accelerationMode: node.config.accelerationMode ?? null,
      externalId: result.ok ? result.stdout.trim() || containerName : null,
      connectCommand: result.ok
        ? ["docker", "exec", "-it", result.stdout.trim() || containerName, "sh"]
        : undefined,
      message: result.ok ? null : result.stderr,
      commandPreview: spec.command,
      updatedAt: new Date().toISOString(),
    };

    await upsertRuntimeState(state);
    return state;
  }

  const qemuBinary = await resolveBinary();

  if (!qemuBinary) {
    console.error("[powerNode] no supported qemu binary found");
    const state = {
      labId,
      nodeId,
      status: "failed" as const,
      runtime: node.runtime,
      accelerationMode: node.config.accelerationMode ?? null,
      externalId: null,
      connectCommand: undefined,
      message:
        "No supported QEMU binary is installed on this host. Tried qemu-system-x86_64, qemu-kvm, and /usr/libexec/qemu-kvm.",
      commandPreview: [],
      updatedAt: new Date().toISOString(),
    };
    await upsertRuntimeState(state);
    return state;
  }

  const platform = getPlatform();
  const networkBackend = getNetworkBackend();
  const resolvedImagePath = await resolveNodeImagePath(node.imageId);
  const hasRealImage = resolvedImagePath !== null;
  const imagePath = resolvedImagePath ?? getDataFile("images/blank-1G.qcow2");

  if (!hasRealImage) {
    console.warn(
      "[powerNode] WARNING: no disk image bound to this node — using blank image. The VM will have no OS. Bind a qcow2 image to the node template first.",
    );
    try {
      await access(imagePath);
    } catch {
      const state = {
        labId,
        nodeId,
        status: "failed" as const,
        runtime: node.runtime,
        accelerationMode: node.config.accelerationMode ?? null,
        externalId: null,
        connectCommand: undefined,
        message: `No disk image is bound to this node and the fallback image ${path.basename(imagePath)} is missing. Bind a qcow2 image to the node template first.`,
        commandPreview: [],
        updatedAt: new Date().toISOString(),
      };
      await upsertRuntimeState(state);
      return state;
    }
  }

  console.log(
    `[powerNode] starting QEMU vm (platform=${platform}, network=${networkBackend}, image=${imagePath})`,
  );

  // Determine inject method early so we know whether to reset the overlay.
  const registry = new TemplateRegistry();
  const template = registry.get(node.templateId);
  const configInjectMethod = template?.boot.configInjectMethod;

  const activeSet = lab.document.activeConfigSetId
    ? lab.document.startupConfigSets.find(
        (s) => s.id === lab.document.activeConfigSetId,
      )
    : null;
  const startupConfig = activeSet?.nodeConfigs.find(
    (nc) => nc.nodeId === nodeId,
  )?.config;

  // Day-0 FAT disk injection (iosv-vfat, csr1000v-vfat) only fires when the
  // router finds no startup-config in NVRAM. If the overlay has been booted
  // before, NVRAM already has a saved config and the FAT disk is ignored.
  // Reset the overlay to a clean copy of the base image so NVRAM is blank
  // and the day-0 disk takes effect.
  const needsFreshOverlay =
    startupConfig !== undefined &&
    (configInjectMethod === "iosv-vfat" ||
      configInjectMethod === "csr1000v-vfat");

  // Each node gets its own private copy of the disk image so multiple nodes
  // can run simultaneously without write-lock conflicts. On APFS (macOS) the
  // OS uses clonefile under the hood, making this instant and space-efficient.
  // Disk state persists across power cycles — the copy lives until the lab is deleted.
  const overlayPath = getNodeOverlayPath(labId, nodeId);
  await mkdir(path.dirname(overlayPath), { recursive: true });
  if (needsFreshOverlay) {
    await rm(overlayPath, { force: true });
    console.log(
      `[powerNode] resetting overlay for day-0 config injection: ${overlayPath}`,
    );
  }
  let effectiveImagePath = imagePath;
  try {
    await access(overlayPath);
    console.log(`[powerNode] reusing existing disk: ${overlayPath}`);
    effectiveImagePath = overlayPath;
  } catch {
    try {
      await copyFile(imagePath, overlayPath);
      console.log(`[powerNode] cloned disk image: ${overlayPath}`);
      effectiveImagePath = overlayPath;
    } catch (err) {
      console.warn(
        `[powerNode] could not clone disk image, using base directly: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  const lockedQemu = await findRunningQemuForDisk(
    effectiveImagePath,
    runCommand,
  );
  if (lockedQemu) {
    const savedNicPorts = existingState?.nicPorts;

    const recoveredState = {
      labId,
      nodeId,
      status: "running" as const,
      runtime: node.runtime,
      accelerationMode: node.config.accelerationMode ?? null,
      externalId: lockedQemu.pid,
      connectCommand: lockedQemu.consolePort
        ? ["telnet", "127.0.0.1", String(lockedQemu.consolePort)]
        : undefined,
      consolePort: lockedQemu.consolePort,
      nicPorts: savedNicPorts,
      message:
        "Recovered existing QEMU process that was already holding the node disk image.",
      commandPreview: existingState?.commandPreview ?? [],
      updatedAt: new Date().toISOString(),
    };

    await upsertRuntimeState(recoveredState);
    if (networkBackend === "socket") {
      await syncSocketTopology();
    }
    console.log(
      `[powerNode] recovered running qemu process pid=${lockedQemu.pid} for node ${nodeId}`,
    );
    return recoveredState;
  }

  const findPort = dependencies.findAvailablePort ?? findAvailablePort;
  const doLaunch = dependencies.launchQemu ?? launchQemu;

  const probe = async (port: number) => (await findPort(port)) === port;
  const serialPort = await findAvailableQemuPortBase(5000, probe);

  // On Linux with TAP networking, bridges and TAP devices must exist before
  // QEMU tries to open them. Reconcile now; ignore "already exists" errors.
  if (networkBackend === "tap") {
    console.log("[powerNode] setting up TAP networking");
    const ops = reconcileTopology(lab.document);
    for (const op of ops) {
      const cmd = buildCommand(op);
      const result = await runCommand(cmd[0]!, cmd.slice(1));
      if (!result.ok) {
        console.warn(
          `[powerNode] network op '${op.kind}' (may already exist): ${result.stderr.trim()}`,
        );
      }
    }
  }

  // Look for sidecar files (cdrom.iso, hdb.qcow2) in the same directory as the
  // source image. vEOS ships with a cdrom.iso flash disk; attach it if present.
  const extraDrives: string[] = [];
  const imageDir = path.dirname(imagePath);
  for (const candidate of ["cdrom.iso", "hdb.qcow2"]) {
    const candidatePath = path.join(imageDir, candidate);
    try {
      await access(candidatePath);
      console.log(`[powerNode] attaching sidecar drive: ${candidatePath}`);
      extraDrives.push(candidatePath);
    } catch {
      // not present, skip
    }
  }

  let configExtraArgs: string[] = [];
  if (
    startupConfig !== undefined &&
    configInjectMethod &&
    configInjectMethod !== "none"
  ) {
    try {
      if (configInjectMethod === "cloud-init") {
        const isoPath = getNodeConfigDrivePath(labId, nodeId, "iso");
        configExtraArgs = await injectCloudInit(startupConfig, isoPath);
        console.log(`[powerNode] injected cloud-init config: ${isoPath}`);
      } else if (configInjectMethod === "iosv-vfat") {
        const imgPath = getNodeConfigDrivePath(labId, nodeId, "img");
        configExtraArgs = await injectIosvVfat(startupConfig, imgPath);
        console.log(`[powerNode] injected IOSv vfat config: ${imgPath}`);
      } else if (configInjectMethod === "csr1000v-vfat") {
        const imgPath = getNodeConfigDrivePath(labId, nodeId, "img");
        configExtraArgs = await injectCsr1000vVfat(startupConfig, imgPath);
        console.log(`[powerNode] injected CSR1000v vfat config: ${imgPath}`);
      } else if (configInjectMethod === "veos-flash") {
        // Flash partition lives inside the main overlay disk (partition 2)
        await injectVeosFlash(startupConfig, effectiveImagePath);
        console.log(
          `[powerNode] injected vEOS flash config into overlay: ${effectiveImagePath}`,
        );
      }
    } catch (err) {
      console.warn(
        `[powerNode] config injection failed (${configInjectMethod}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // On macOS (socket backend) each NIC gets its own listen port. The virtual
  // switch connects to all of them and forwards frames between attached ports,
  // so the cable topology can change at runtime without rebooting VMs.
  const nicPorts =
    networkBackend === "socket"
      ? await findConsecutivePorts(
          20000,
          node.config.interfaceCount,
          probe,
        ).then((base) =>
          Array.from(
            { length: node.config.interfaceCount },
            (_, i) => base + i,
          ),
        )
      : undefined;

  if (nicPorts) {
    console.log(`[powerNode] NIC ports: ${nicPorts.join(", ")}`);
  }

  const qemuCommand = buildQemuCommand({
    qemuBinary,
    labId,
    nodeId,
    imagePath: effectiveImagePath,
    extraDrives,
    extraArgs: configExtraArgs,
    machineType: "q35",
    // CSR1000v day-0 config requires both disks on IDE (hda=OS, hdb=config)
    mainDiskInterface:
      configInjectMethod === "csr1000v-vfat" ? "ide" : "virtio",
    config: {
      ramMb: node.config.ramMb,
      vcpu: node.config.vcpu,
      interfaceCount: node.config.interfaceCount,
      nicModel: node.config.nicModel,
      accelerationMode: node.config.accelerationMode,
    },
    nicPorts,
    networkBackend,
  });

  const result = await doLaunch(qemuCommand, serialPort);

  const state = {
    labId,
    nodeId,
    status: result.ok ? ("running" as const) : ("failed" as const),
    runtime: node.runtime,
    accelerationMode: node.config.accelerationMode ?? null,
    externalId: result.ok ? String(result.pid) : null,
    connectCommand: result.ok
      ? ["telnet", "127.0.0.1", String(serialPort)]
      : undefined,
    consolePort: result.ok ? serialPort : null,
    nicPorts: result.ok ? nicPorts : undefined,
    message: result.ok ? null : result.stderr,
    commandPreview: qemuCommand,
    updatedAt: new Date().toISOString(),
  };

  await upsertRuntimeState(state);
  if (result.ok && networkBackend === "socket") {
    await syncSocketTopology();
  }
  return state;
}

export async function powerOffNode(
  labId: string,
  nodeId: string,
  dependencies: RuntimeDependencies = {},
) {
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const states = await listRuntimeStates(labId);
  const previous = states.find((state) => state.nodeId === nodeId);

  console.log(`[powerNode] powering off node ${nodeId} in lab ${labId}`);

  if (
    previous?.runtime === "container" &&
    previous.externalId &&
    previous.status === "running"
  ) {
    const lab = await getLab(labId);
    if (lab) {
      const attachments = getNodeAttachmentsForContainer(lab.document, nodeId);
      const containerId = previous.externalId;

      for (const attachment of attachments) {
        const disconnectCmd = buildDockerNetworkDisconnectCommand(
          attachment.networkId,
          containerId,
        );
        await runCommand(disconnectCmd[0]!, disconnectCmd.slice(1));
      }

      await runCommand("docker", ["stop", containerId]);
      await runCommand("docker", ["rm", "-f", containerId]);
    }
  }

  if (
    previous?.runtime === "qemu" &&
    previous.externalId &&
    previous.status === "running"
  ) {
    await runCommand("kill", [previous.externalId]);

    const lab = await getLab(labId);
    if (lab) {
      const node = lab.document.nodes.find((n) => n.id === nodeId);
      if (node) {
        if (getNetworkBackend() === "socket") {
          // Deregister NICs from the virtual switch.
          for (const iface of node.interfaces)
            virtualSwitch.removeNic(iface.id);
        } else {
          // Clean up TAP devices that belonged to this node.
          const attachedSlots = lab.document.attachments
            .map((a) => node.interfaces.find((i) => i.id === a.interfaceId))
            .filter((i): i is NonNullable<typeof i> => i !== undefined)
            .map((i) => i.slot);

          for (const slot of attachedSlots) {
            const tap = tapName(labId, nodeId, slot);
            const result = await runCommand("ip", ["link", "del", "dev", tap]);
            if (!result.ok) {
              console.warn(
                `[powerNode] TAP cleanup for ${tap}: ${result.stderr.trim()}`,
              );
            }
          }
        }
      }
    }
  }

  const state = {
    labId,
    nodeId,
    status: "stopped" as const,
    runtime: previous?.runtime ?? "qemu",
    accelerationMode: previous?.accelerationMode ?? null,
    externalId: previous?.externalId ?? null,
    connectCommand: previous?.connectCommand,
    message: previous?.message ?? null,
    commandPreview: previous?.commandPreview ?? [],
    updatedAt: new Date().toISOString(),
  };

  await upsertRuntimeState(state);
  if (getNetworkBackend() === "socket") {
    await syncSocketTopology();
  }
  return state;
}
