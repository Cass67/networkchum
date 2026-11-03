import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getLab, updateLabDocument } from "../labs/labStore.js";
import {
  buildDockerNetworkConnectCommand,
  buildDockerNetworkCreateCommand,
  buildDockerNetworkDisconnectCommand,
  dockerNetworkName,
  getNodeAttachmentsForContainer,
} from "../network/dockerNetworking.js";
import { buildCommand } from "../network/buildCommands.js";
import { ipCommand } from "../network/ipCommand.js";
import { ensureManagementBridgeUplink } from "../network/managementUplink.js";
import { reconcileTopology, bridgeName } from "../network/reconcileTopology.js";
import {
  buildBridgeTargetByNetworkId,
  buildCloudRoleByNetworkId,
  isLinuxBridgeInterface,
  resolveCloudBridge,
  shouldDetachCloudUplink,
  validateCloudBridgeTargets,
} from "../network/cloudUplink.js";
import { buildContainerSpec } from "./container/buildContainerSpec.js";
import { detectContainerEngine } from "./container/containerRuntimeService.js";
import { resolveNodeImagePath } from "../images/resolveNodeImage.js";
import { buildQemuCommand, tapName } from "./qemu/buildQemuCommand.js";

// UEFI firmware for templates that need it (NX-OSv 9000). Prefer the unified
// image; fall back to the distro layouts.
function resolveUefiFirmware(): string | undefined {
  const candidates = [
    "/usr/share/qemu/OVMF.fd",
    "/usr/share/ovmf/OVMF.fd",
    "/usr/share/OVMF/OVMF.fd",
    "/usr/share/OVMF/OVMF_CODE.fd",
    "/usr/local/share/qemu/OVMF.fd",
    "/opt/homebrew/share/qemu/OVMF.fd",
  ];
  return candidates.find((candidate) => existsSync(candidate));
}
import {
  isQemuProcessCommandLine,
  resolveQemuBinary,
} from "./qemu/resolveQemuBinary.js";
import { syncSocketTopology } from "./syncSocketTopology.js";
import { virtualSwitch } from "./virtualSwitch.js";
import { getNetworkBackend, getPlatform } from "./hostCapabilities.js";
import { reconcileRuntimeStates } from "./reconcileRuntimeStates.js";
import { listRuntimeStates, upsertRuntimeState } from "./runtimeStateStore.js";
import type { RuntimeState } from "./runtimeStateStore.js";
import {
  getDataFile,
  getNodeConfigDrivePath,
  getNodeOverlayPath,
} from "../storagePaths.js";
import {
  injectCloudInit,
  injectCsr1000vConfigDrive,
  injectFortigateConfigDrive,
  injectIosvVfat,
  injectIosxrCvac,
  injectJunosConfigDisk,
  injectJunosEvoConfigDisk,
  injectNxosCvac,
  injectVeosFlash,
  injectVsrxBootstrapIso,
  injectVyosCloudInit,
  junosEvoProfileArgs,
  resolveJunosEvoUefiFirmware,
} from "./configInjectors.js";
import { TemplateRegistry } from "../templates/templateRegistry.js";
import { setNodeBootActions } from "../topology/mutations.js";
import { buildMacOsManagementUnavailableMessage } from "./macosManagementCloud.js";
import type {
  LabDocument,
  LabNode,
  NodeBootAction,
  NodeBootActionState,
} from "@networkchum/shared";

const execFileAsync = promisify(execFile);

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

type ScheduleRunningConfigBackupParams = {
  labId: string;
  nodeId: string;
  node: LabNode;
  runtimeState: RuntimeState;
  runningConfigBackupAction: NodeBootAction;
};

type RuntimeDependencies = {
  runCommand?: (command: string, args: string[]) => Promise<CommandResult>;
  hasBinary?: (command: string) => Promise<boolean>;
  tapExists?: (tapName: string) => Promise<boolean>;
  resolveQemuBinary?: () => Promise<string | null>;
  launchQemu?: (
    command: string[],
    serialPort: number,
  ) => Promise<{ ok: boolean; pid: number | null; stderr: string }>;
  findAvailablePort?: (startPort: number) => Promise<number>;
  scheduleRunningConfigBackup?: (
    params: ScheduleRunningConfigBackupParams,
  ) => Promise<unknown>;
  isBridgeInterface?: (interfaceName: string) => Promise<boolean>;
};

function resolveNodeBootSettings(
  bootActions: LabDocument["nodeBootActions"],
  nodeId: string,
): Pick<NodeBootActionState, "startupConfig" | "runningConfigBackup"> {
  const entry = bootActions.find((candidate) => candidate.nodeId === nodeId);
  if (!entry) {
    return {
      startupConfig: "none" as const,
      runningConfigBackup: "none" as const,
    };
  }

  return {
    startupConfig: (entry.startupConfig ?? "none") as NodeBootAction,
    runningConfigBackup: (entry.runningConfigBackup ??
      "none") as NodeBootAction,
  };
}

function isAlreadyExistsError(stderr: string): boolean {
  return /already exists|File exists|Device or resource busy/i.test(stderr);
}

function isContainerNameAlreadyInUseError(
  stderr: string,
  containerName: string,
): boolean {
  return (
    stderr.includes(containerName) &&
    /container name .*already in use|name .*already in use/i.test(stderr)
  );
}

function buildNetworkFailureMessage(
  opKind: string,
  stderr: string,
  cmd: string[],
): string {
  return `Linux TAP setup failed during '${opKind}' (${cmd.join(" ")}): ${stderr.trim() || "command failed"}. NetworkChum needs permission to manage bridges and TAP devices (CAP_NET_ADMIN/root), and stale TAP devices may need to be recreated.`;
}

export async function ensureTapNetworking(
  document: LabDocument,
  runCommand: (command: string, args: string[]) => Promise<CommandResult>,
  tapExists: (tapName: string) => Promise<boolean> = async (tapName) => {
    try {
      await access(`/sys/class/net/${tapName}`);
      return true;
    } catch {
      return false;
    }
  },
  targetNodeId?: string,
  isBridgeInterface: (
    interfaceName: string,
  ) => Promise<boolean> = isLinuxBridgeInterface,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const validation = await validateCloudBridgeTargets(
    document,
    targetNodeId,
    isBridgeInterface,
  );
  if (!validation.ok) {
    return validation;
  }

  const bridgeTargets = await buildBridgeTargetByNetworkId(
    document,
    isBridgeInterface,
  );
  const ops = reconcileTopology(document, targetNodeId, bridgeTargets);

  for (const op of ops) {
    const cmd = buildCommand(op);
    let result = await runCommand(cmd[0]!, cmd.slice(1));

    if (
      !result.ok &&
      op.kind === "create-tap" &&
      isAlreadyExistsError(result.stderr)
    ) {
      const deleteCmd = buildCommand({
        kind: "delete-tap",
        tapName: op.tapName,
      });
      const deleteResult = await runCommand(deleteCmd[0]!, deleteCmd.slice(1));
      if (!deleteResult.ok) {
        return {
          ok: false,
          message: buildNetworkFailureMessage(
            "delete-tap",
            deleteResult.stderr,
            deleteCmd,
          ),
        };
      }

      result = await runCommand(cmd[0]!, cmd.slice(1));
    }

    if (!result.ok) {
      if (
        (op.kind === "create-bridge" || op.kind === "attach-to-bridge") &&
        isAlreadyExistsError(result.stderr)
      ) {
        continue;
      }

      return {
        ok: false,
        message: buildNetworkFailureMessage(op.kind, result.stderr, cmd),
      };
    }
  }

  const managementUplinkResult = await ensureManagementBridgeUplink(
    runCommand,
    bridgeTargets,
  );
  if (!managementUplinkResult.ok) {
    return managementUplinkResult;
  }

  const expectedTaps = ops
    .filter(
      (op): op is Extract<typeof op, { kind: "create-tap" }> =>
        op.kind === "create-tap",
    )
    .map((op) => op.tapName);

  for (const tapName of expectedTaps) {
    if (!(await tapExists(tapName))) {
      return {
        ok: false,
        message: `Linux TAP setup reported success, but expected TAP device '${tapName}' is missing. The API process may not have permission to create persistent TAP devices on this host.`,
      };
    }
  }

  return { ok: true };
}

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

async function resolveContainerEngine(
  preferred: "docker" | "podman" | undefined,
  hasBinary: (command: string) => Promise<boolean>,
  runCommand: (command: string, args: string[]) => Promise<CommandResult>,
): Promise<"docker" | "podman"> {
  if (preferred && (await hasBinary(preferred))) {
    const availability = await runCommand(preferred, ["info"]);
    if (availability.ok) {
      return preferred;
    }
  }

  return (await detectContainerEngine(hasBinary, runCommand)) ?? "docker";
}

function commandPreviewEngine(commandPreview?: string[]): "docker" | "podman" {
  return commandPreview?.[0] === "podman" ? "podman" : "docker";
}

async function hasMacOsHostOnlyManagementBackend(
  resolveBinary: () => Promise<string | null>,
  runCommand: (command: string, args: string[]) => Promise<CommandResult>,
): Promise<boolean> {
  const qemuBinary = await resolveBinary();
  if (!qemuBinary) {
    return false;
  }

  const helpResult = await runCommand(qemuBinary, ["-netdev", "help"]);
  const output = `${helpResult.stdout}${helpResult.stderr}`;
  return helpResult.ok && output.includes("vmnet-host");
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

  // Lab bridges are virtual patch panels: always "on", no process to launch.
  if (node.runtime === "lab-bridge") {
    return null;
  }

  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const hasBinary = dependencies.hasBinary ?? defaultHasBinary;
  const resolveBinary =
    dependencies.resolveQemuBinary ?? (() => resolveQemuBinary(hasBinary));
  const existingStates = dependencies.runCommand
    ? await reconcileRuntimeStates(labId, runCommand)
    : await listRuntimeStates(labId);
  const existingState = existingStates.find((state) => state.nodeId === nodeId);
  const templateRegistry = new TemplateRegistry();

  const bootActions = lab.document.nodeBootActions ?? [];
  const nodeBootSettings = resolveNodeBootSettings(bootActions, nodeId);
  const clearOneShotBootAction = async () => {
    const nextActions = {
      startupConfig:
        nodeBootSettings.startupConfig === "once"
          ? ("none" as const)
          : nodeBootSettings.startupConfig,
      runningConfigBackup:
        nodeBootSettings.runningConfigBackup === "once"
          ? ("none" as const)
          : nodeBootSettings.runningConfigBackup,
    };

    if (
      nextActions.startupConfig === nodeBootSettings.startupConfig &&
      nextActions.runningConfigBackup === nodeBootSettings.runningConfigBackup
    ) {
      return;
    }

    const clearedDocument = setNodeBootActions(
      lab.document,
      nodeId,
      nextActions,
    );
    try {
      await updateLabDocument(labId, clearedDocument);
    } catch (error) {
      console.warn(
        `[powerNode] failed to clear node boot action for ${nodeId}: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  };

  const scheduleRunningConfigBackup = dependencies.scheduleRunningConfigBackup;
  const scheduleBackupIfNeeded = (runtimeState: RuntimeState) => {
    if (
      nodeBootSettings.runningConfigBackup === "none" ||
      runtimeState.status !== "running" ||
      !scheduleRunningConfigBackup
    ) {
      return;
    }

    try {
      const maybePromise = scheduleRunningConfigBackup({
        labId,
        nodeId,
        node,
        runtimeState,
        runningConfigBackupAction: nodeBootSettings.runningConfigBackup,
      });
      Promise.resolve(maybePromise).catch((error) => {
        console.warn(
          `[powerNode] failed to schedule running config backup for ${nodeId}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      });
    } catch (error) {
      console.warn(
        `[powerNode] failed to schedule running config backup for ${nodeId}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  };

  const platform = getPlatform();
  const networkBackend = getNetworkBackend();

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
    const template = templateRegistry.get(node.templateId);
    const engine = await resolveContainerEngine(
      node.config.containerEngine ?? template?.container?.engine,
      hasBinary,
      runCommand,
    );
    const imageRef =
      node.config.containerImageRef ?? template?.container?.imageRef;
    const shell =
      node.config.containerShell ?? template?.container?.defaultShell ?? "sh";

    if (!imageRef) {
      const state = {
        labId,
        nodeId,
        status: "failed" as const,
        runtime: node.runtime,
        accelerationMode: node.config.accelerationMode ?? null,
        externalId: null,
        connectCommand: undefined,
        message: "Container image reference is missing for this node.",
        commandPreview: [],
        updatedAt: new Date().toISOString(),
      };
      await upsertRuntimeState(state);
      return state;
    }

    const networkIds = [...new Set(attachments.map((a) => a.networkId))];
    for (const networkId of networkIds) {
      const createCmd = buildDockerNetworkCreateCommand(networkId, engine);
      await runCommand(createCmd[0]!, createCmd.slice(1));
    }

    const primaryNetwork = attachments[0]
      ? dockerNetworkName(attachments[0].networkId)
      : undefined;

    const spec = buildContainerSpec({
      engine,
      nodeName: containerName,
      image: imageRef,
      cpu: node.config.vcpu,
      memoryMb: node.config.ramMb,
      network: primaryNetwork,
      shell,
    });
    console.log("[powerNode] container command:", spec.command.join(" "));
    let result = await runCommand(spec.command[0]!, spec.command.slice(1));
    if (
      !result.ok &&
      isContainerNameAlreadyInUseError(result.stderr, containerName)
    ) {
      const removeResult = await runCommand(engine, [
        "rm",
        "-f",
        containerName,
      ]);
      result = removeResult.ok
        ? await runCommand(spec.command[0]!, spec.command.slice(1))
        : removeResult;
    }

    if (result.ok) {
      console.log(`[powerNode] container started: ${result.stdout.trim()}`);
      for (let i = 1; i < attachments.length; i += 1) {
        const connectCmd = buildDockerNetworkConnectCommand(
          attachments[i]!.networkId,
          containerName,
          engine,
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
        ? [engine, "exec", "-it", containerName, shell]
        : undefined,
      message: result.ok ? null : result.stderr,
      commandPreview: spec.command,
      updatedAt: new Date().toISOString(),
    };

    await upsertRuntimeState(state);
    scheduleBackupIfNeeded(state);
    await clearOneShotBootAction();
    return state;
  }

  if (node.runtime === "cloud") {
    console.log(`[powerNode] activating cloud node ${nodeId} in lab ${labId}`);

    const resolvedBridge = resolveCloudBridge(node);
    const cloudRole =
      resolvedBridge?.cloudRole ?? node.config.cloudRole ?? null;

    if (cloudRole === "management" && platform === "macos") {
      const available = await hasMacOsHostOnlyManagementBackend(
        resolveBinary,
        runCommand,
      );

      const ok = available;
      const errorMsg = ok ? null : buildMacOsManagementUnavailableMessage();

      const state = {
        labId,
        nodeId,
        status: ok ? ("running" as const) : ("failed" as const),
        runtime: "cloud" as const,
        accelerationMode: null,
        // Avoid container cleanup on power-off; host-only backend has no external ID.
        externalId: null,
        cloudBackend: "macos-management" as const,
        connectCommand: undefined,
        consolePort: null,
        nicPorts: undefined,
        message: errorMsg,
        commandPreview: [],
        updatedAt: new Date().toISOString(),
      };
      await upsertRuntimeState(state);
      scheduleBackupIfNeeded(state);
      await clearOneShotBootAction();
      return state;
    }

    if (cloudRole === "management" && platform !== "linux") {
      const state = {
        labId,
        nodeId,
        status: "failed" as const,
        runtime: "cloud" as const,
        accelerationMode: null,
        externalId: null,
        connectCommand: undefined,
        consolePort: null,
        nicPorts: undefined,
        message: `Management cloud is only supported on Linux (TAP/bridge) and macOS (host-only management backend). This host platform is '${platform}'.`,
        commandPreview: [],
        updatedAt: new Date().toISOString(),
      };
      await upsertRuntimeState(state);
      scheduleBackupIfNeeded(state);
      await clearOneShotBootAction();
      return state;
    }

    if (networkBackend === "tap") {
      const networkResult = await ensureTapNetworking(
        lab.document,
        runCommand,
        undefined,
        nodeId,
        dependencies.isBridgeInterface,
      );
      const ok = networkResult.ok;
      const errorMsg = networkResult.ok ? null : networkResult.message;

      const state = {
        labId,
        nodeId,
        status: ok ? ("running" as const) : ("failed" as const),
        runtime: "cloud" as const,
        accelerationMode: null,
        externalId: ok ? "cloud-tap" : null,
        cloudBackend: "tap" as const,
        connectCommand: undefined,
        consolePort: null,
        nicPorts: undefined,
        message: errorMsg,
        commandPreview: [],
        updatedAt: new Date().toISOString(),
      };
      await upsertRuntimeState(state);
      scheduleBackupIfNeeded(state);
      await clearOneShotBootAction();
      return state;
    }

    const containerName = runtimeName(labId, nodeId);
    const attachments = getNodeAttachmentsForContainer(lab.document, nodeId);
    const engine = await resolveContainerEngine(
      undefined,
      hasBinary,
      runCommand,
    );

    const networkIds = [...new Set(attachments.map((a) => a.networkId))];
    for (const networkId of networkIds) {
      const createCmd = buildDockerNetworkCreateCommand(networkId, engine);
      await runCommand(createCmd[0]!, createCmd.slice(1));
    }

    const primaryNetwork = attachments[0]
      ? dockerNetworkName(attachments[0].networkId)
      : undefined;

    const spec = buildContainerSpec({
      engine,
      nodeName: containerName,
      image: "alpine:latest",
      cpu: 1,
      memoryMb: 128,
      network: primaryNetwork,
    });
    console.log("[powerNode] cloud NAT container:", spec.command.join(" "));
    const result = await runCommand(spec.command[0]!, spec.command.slice(1));

    if (result.ok) {
      const containerId = result.stdout.trim() || containerName;
      const natCommands = [
        [
          engine,
          "exec",
          containerId,
          "sh",
          "-c",
          "apk add --no-cache iptables",
        ],
        [
          engine,
          "exec",
          containerId,
          "sh",
          "-c",
          "sysctl -w net.ipv4.ip_forward=1",
        ],
        [
          engine,
          "exec",
          containerId,
          "sh",
          "-c",
          "iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE",
        ],
        [
          engine,
          "exec",
          containerId,
          "sh",
          "-c",
          "iptables -A FORWARD -i eth0 -o eth1 -j ACCEPT",
        ],
        [
          engine,
          "exec",
          containerId,
          "sh",
          "-c",
          "iptables -A FORWARD -i eth1 -o eth0 -j ACCEPT",
        ],
      ];
      for (const cmd of natCommands) {
        await runCommand(cmd[0]!, cmd.slice(1));
      }

      for (let i = 1; i < attachments.length; i += 1) {
        const connectCmd = buildDockerNetworkConnectCommand(
          attachments[i]!.networkId,
          containerId,
          engine,
        );
        await runCommand(connectCmd[0]!, connectCmd.slice(1));
      }
    }

    const state = {
      labId,
      nodeId,
      status: result.ok ? ("running" as const) : ("failed" as const),
      runtime: "cloud" as const,
      accelerationMode: null,
      externalId: result.ok ? result.stdout.trim() || containerName : null,
      cloudBackend: "container-nat" as const,
      connectCommand: undefined,
      consolePort: null,
      nicPorts: undefined,
      message: result.ok ? null : result.stderr,
      commandPreview: spec.command,
      updatedAt: new Date().toISOString(),
    };
    await upsertRuntimeState(state);
    scheduleBackupIfNeeded(state);
    await clearOneShotBootAction();
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
  const template = templateRegistry.get(node.templateId);
  const configInjectMethod = template?.boot.configInjectMethod;

  // Junos Evolved images need a platform-identity profile on EVERY boot
  // (Bochs SMBIOS identity + USB bus, UEFI for 24.2R+). Without it the image
  // loops forever on "unsupported platform or XID mismatch" and never
  // provisions — refuse to boot a 24.2R+ image when no UEFI firmware exists
  // rather than leaving the lab with a hung node.
  let evoProfileArgs: string[] = [];
  if (configInjectMethod === "junos-evo-config-disk" && hasRealImage) {
    let uefi = await resolveJunosEvoUefiFirmware();
    if (uefi?.kind === "pflash") {
      // OVMF vars must be writable per node, so each node gets its own copy.
      const nodeVarsPath = getNodeConfigDrivePath(labId, nodeId, "vars");
      try {
        await access(nodeVarsPath);
      } catch {
        await copyFile(uefi.varsPath, nodeVarsPath);
      }
      uefi = {
        kind: "pflash",
        codePath: uefi.codePath,
        varsPath: nodeVarsPath,
      };
    }
    const profileArgs = junosEvoProfileArgs(
      path.basename(resolvedImagePath ?? imagePath),
      uefi,
    );
    if (profileArgs === null) {
      const state = {
        labId,
        nodeId,
        status: "failed" as const,
        runtime: node.runtime,
        accelerationMode: node.config.accelerationMode ?? null,
        externalId: null,
        connectCommand: undefined,
        message:
          "This Junos Evolved image (24.2R+) requires UEFI firmware (OVMF/edk2), which was not found on this host. Install it (Debian/RHEL: ovmf package; macOS: qemu via Homebrew) and power the node again.",
        commandPreview: [],
        updatedAt: new Date().toISOString(),
      };
      await upsertRuntimeState(state);
      return state;
    }
    evoProfileArgs = profileArgs;
    console.log(
      `[powerNode] Junos Evolved profile args: ${evoProfileArgs.join(" ")}`,
    );
  }

  const activeSet = lab.document.activeConfigSetId
    ? lab.document.startupConfigSets.find(
        (s) => s.id === lab.document.activeConfigSetId,
      )
    : null;
  const startupConfig = activeSet?.nodeConfigs.find(
    (nc) => nc.nodeId === nodeId,
  )?.config;

  const hasStartupConfigText =
    typeof startupConfig === "string" && startupConfig.trim().length > 0;
  const shouldInjectStartupConfig =
    nodeBootSettings.startupConfig !== "none" && hasStartupConfigText;

  // Day-0 FAT disk injection now requires an explicit startup-config inject
  // mode and non-blank startup config text so the overlay can be reset safely.
  const needsFreshOverlay =
    shouldInjectStartupConfig &&
    (configInjectMethod === "iosv-vfat" ||
      configInjectMethod === "csr1000v-vfat");

  // Each node gets its own private copy of the disk image so multiple nodes
  // can run simultaneously without write-lock conflicts. On APFS (macOS) the
  // OS uses clonefile under the hood, making this instant and space-efficient.
  // Disk state persists across power cycles — the copy lives until the lab is deleted.
  const overlayPath = getNodeOverlayPath(labId, nodeId);
  await mkdir(path.dirname(overlayPath), { recursive: true });

  const lockedQemu = await findRunningQemuForDisk(overlayPath, runCommand);
  if (lockedQemu) {
    const savedNicPorts = existingState?.nicPorts;
    const savedNicBackends = existingState?.nicBackends;

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
      nicBackends: savedNicBackends,
      message:
        "Recovered existing QEMU process that was already holding the node disk image.",
      commandPreview: existingState?.commandPreview ?? [],
      updatedAt: new Date().toISOString(),
    };

    await upsertRuntimeState(recoveredState);
    await clearOneShotBootAction();
    if (networkBackend === "socket") {
      await syncSocketTopology();
    }
    console.log(
      `[powerNode] recovered running qemu process pid=${lockedQemu.pid} for node ${nodeId}`,
    );
    return recoveredState;
  }

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

  const findPort = dependencies.findAvailablePort ?? findAvailablePort;
  const doLaunch = dependencies.launchQemu ?? launchQemu;

  const probe = async (port: number) => (await findPort(port)) === port;
  const serialPort = await findAvailableQemuPortBase(5000, probe);

  // On Linux with TAP networking, bridges and TAP devices must exist before
  // QEMU tries to open them. Reconcile now; ignore "already exists" errors.
  if (networkBackend === "tap") {
    console.log("[powerNode] setting up TAP networking");
    const networkResult = await ensureTapNetworking(
      lab.document,
      runCommand,
      dependencies.tapExists,
      nodeId,
    );
    if (!networkResult.ok) {
      console.error(`[powerNode] ${networkResult.message}`);
      const state = {
        labId,
        nodeId,
        status: "failed" as const,
        runtime: node.runtime,
        accelerationMode: node.config.accelerationMode ?? null,
        externalId: null,
        connectCommand: undefined,
        message: networkResult.message,
        commandPreview: [],
        updatedAt: new Date().toISOString(),
      };
      await upsertRuntimeState(state);
      return state;
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

  let configExtraArgs: string[] = [...evoProfileArgs];
  if (
    shouldInjectStartupConfig &&
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
        const configDrive = await injectCsr1000vConfigDrive(
          startupConfig,
          imgPath,
        );
        configExtraArgs = [...configDrive.qemuArgs];
        console.log(
          `[powerNode] selected CSR1000v config-drive layout=${configDrive.layout} artifact=${configDrive.outputPath}`,
        );
      } else if (configInjectMethod === "iosxr-cvac") {
        const isoPath = getNodeConfigDrivePath(labId, nodeId, "iso");
        configExtraArgs = await injectIosxrCvac(startupConfig, isoPath);
        console.log(`[powerNode] injected IOS-XR CVAC config: ${isoPath}`);
      } else if (configInjectMethod === "nxos-cvac") {
        const isoPath = getNodeConfigDrivePath(labId, nodeId, "iso");
        configExtraArgs = await injectNxosCvac(startupConfig, isoPath);
        console.log(`[powerNode] injected NX-OS CVAC config: ${isoPath}`);
      } else if (configInjectMethod === "vsrx-bootstrap-iso") {
        const isoPath = getNodeConfigDrivePath(labId, nodeId, "iso");
        configExtraArgs = await injectVsrxBootstrapIso(startupConfig, isoPath);
        console.log(`[powerNode] injected vSRX bootstrap config: ${isoPath}`);
      } else if (configInjectMethod === "fortigate-config-drive") {
        const isoPath = getNodeConfigDrivePath(labId, nodeId, "iso");
        configExtraArgs = await injectFortigateConfigDrive(
          startupConfig,
          isoPath,
        );
        console.log(`[powerNode] injected FortiGate config drive: ${isoPath}`);
      } else if (configInjectMethod === "vyos-cloud-init") {
        const isoPath = getNodeConfigDrivePath(labId, nodeId, "iso");
        configExtraArgs = await injectVyosCloudInit(startupConfig, isoPath);
        console.log(`[powerNode] injected VyOS cloud-init config: ${isoPath}`);
      } else if (configInjectMethod === "junos-config-disk") {
        const imgPath = getNodeConfigDrivePath(labId, nodeId, "img");
        configExtraArgs = await injectJunosConfigDisk(startupConfig, imgPath);
        console.log(`[powerNode] injected Junos config disk: ${imgPath}`);
      } else if (configInjectMethod === "junos-evo-config-disk") {
        const imgPath = getNodeConfigDrivePath(labId, nodeId, "img");
        const injectionArgs = await injectJunosEvoConfigDisk(
          startupConfig,
          imgPath,
        );
        configExtraArgs = [...configExtraArgs, ...injectionArgs];
        console.log(`[powerNode] injected Junos EVO config disk: ${imgPath}`);
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
  let nicBackends: Array<{ kind: "macos-management" }> | undefined;
  let nicBackendKinds: Array<"macos-management" | null> | undefined;
  if (platform === "macos") {
    nicBackendKinds = Array.from(
      { length: node.config.interfaceCount },
      () => null,
    );
    const rolesByNetworkId = buildCloudRoleByNetworkId(lab.document);
    const networkIdByInterfaceId = new Map(
      lab.document.attachments.map((attachment) => [
        attachment.interfaceId,
        attachment.networkId,
      ]),
    );

    for (const iface of node.interfaces) {
      const networkId = networkIdByInterfaceId.get(iface.id);
      if (!networkId) continue;
      if (rolesByNetworkId.get(networkId) !== "management") continue;
      nicBackends ??= [];
      nicBackends[iface.slot] = { kind: "macos-management" };
      nicBackendKinds[iface.slot] = "macos-management";
    }
  }

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

  const boot = template?.boot;
  const firmware = boot?.firmware === "uefi" ? "uefi" : "bios";
  const uefiFirmwarePath =
    firmware === "uefi" ? resolveUefiFirmware() : undefined;
  if (firmware === "uefi" && !uefiFirmwarePath) {
    throw new Error(
      `Template ${node.templateId} needs UEFI firmware but no OVMF image was found. Install the ovmf package (for example /usr/share/qemu/OVMF.fd).`,
    );
  }

  const qemuCommand = buildQemuCommand({
    qemuBinary,
    labId,
    nodeId,
    imagePath: effectiveImagePath,
    extraDrives,
    extraArgs: configExtraArgs,
    machineType: boot?.machineType ?? "q35",
    firmware,
    uefiFirmwarePath,
    cpuModel: boot?.cpuModel,
    // CSR1000v (IOS-XE): main disk on IDE so BIOS boots it; virtio config
    // disk is invisible to BIOS but scanned by IOS-XE for day-0 config.
    mainDiskInterface:
      boot?.diskInterface ??
      (configInjectMethod === "csr1000v-vfat" ||
      configInjectMethod === "junos-config-disk"
        ? "ide"
        : undefined),
    config: {
      ramMb: node.config.ramMb,
      vcpu: node.config.vcpu,
      interfaceCount: node.config.interfaceCount,
      nicModel: node.config.nicModel,
      accelerationMode: node.config.accelerationMode,
    },
    nicPorts,
    nicBackends,
    networkBackend,
  });

  const commandPreview = [...qemuCommand];
  console.log(`[powerNode] QEMU command preview: ${commandPreview.join(" ")}`);

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
    nicBackends: result.ok ? nicBackendKinds : undefined,
    message: result.ok ? null : result.stderr,
    commandPreview,
    updatedAt: new Date().toISOString(),
  };

  await upsertRuntimeState(state);
  scheduleBackupIfNeeded(state);
  await clearOneShotBootAction();
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
  const lab = await getLab(labId);
  const bridgeNode = lab?.document.nodes.find(
    (entry) => entry.id === nodeId && entry.runtime === "lab-bridge",
  );
  if (bridgeNode) {
    // Virtual patch panels have no process to stop.
    return null;
  }

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
      const node = lab.document.nodes.find((entry) => entry.id === nodeId);
      const engine =
        node?.config.containerEngine ??
        commandPreviewEngine(previous.commandPreview);

      for (const attachment of attachments) {
        const disconnectCmd = buildDockerNetworkDisconnectCommand(
          attachment.networkId,
          containerId,
          engine,
        );
        await runCommand(disconnectCmd[0]!, disconnectCmd.slice(1));
      }

      await runCommand(engine, ["stop", containerId]);
      await runCommand(engine, ["rm", "-f", containerId]);
    }
  }

  if (previous?.runtime === "cloud" && previous.status === "running") {
    if (getNetworkBackend() === "tap") {
      const lab = await getLab(labId);
      if (lab) {
        const node = lab.document.nodes.find((n) => n.id === nodeId);
        if (node) {
          const physicalNic =
            resolveCloudBridge(node)?.bridgeName ??
            node.config.bridgeInterface ??
            null;
          if (
            physicalNic &&
            (await shouldDetachCloudUplink(
              physicalNic,
              dependencies.isBridgeInterface ?? isLinuxBridgeInterface,
            ))
          ) {
            const delCmd = ipCommand([
              "link",
              "set",
              "dev",
              physicalNic,
              "nomaster",
            ]);
            await runCommand(delCmd[0]!, delCmd.slice(1)).catch(() => {});
          }
        }
      }
    } else {
      if (previous.externalId) {
        const engine = commandPreviewEngine(previous.commandPreview);
        await runCommand(engine, ["stop", previous.externalId]);
        await runCommand(engine, ["rm", "-f", previous.externalId]);
      }
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
            const delCmd = ipCommand(["link", "del", "dev", tap]);
            const result = await runCommand(delCmd[0]!, delCmd.slice(1));
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
