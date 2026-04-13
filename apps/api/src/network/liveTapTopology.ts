import type { LabDocument, LabNode } from "@networkchum/shared";

import type { RuntimeState } from "../runtime/runtimeStateStore.js";
import { listRuntimeStates } from "../runtime/runtimeStateStore.js";
import { getNetworkBackend } from "../runtime/hostCapabilities.js";
import { ensureTapNetworking } from "../runtime/powerNode.js";
import { tapName } from "../runtime/qemu/buildQemuCommand.js";
import {
  isLinuxBridgeInterface,
  shouldDetachCloudUplink,
} from "./cloudUplink.js";
import { detectPhysicalNic } from "./reconcileTopology.js";

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

type RunCommand = (command: string, args: string[]) => Promise<CommandResult>;

type RuntimeContext = {
  runCommand?: RunCommand;
};

type LiveTapSyncDependencies = {
  networkBackend?: "tap" | "socket";
  listRuntimeStates?: (labId?: string) => Promise<RuntimeState[]>;
  ensureTapNetworking?: typeof ensureTapNetworking;
  tapExists?: Parameters<typeof ensureTapNetworking>[2];
  isBridgeInterface?: (interfaceName: string) => Promise<boolean>;
  detectPhysicalNic?: () => string | null;
  warn?: (message: string) => void;
};

function defaultWarn(message: string) {
  console.warn(message);
}

function resolvedNetworkBackend(
  deps: LiveTapSyncDependencies,
): "tap" | "socket" {
  return deps.networkBackend ?? getNetworkBackend();
}

function findNodeById(
  document: LabDocument,
  nodeId: string,
): LabNode | undefined {
  return document.nodes.find((node) => node.id === nodeId);
}

function findNodeByInterfaceId(
  document: LabDocument,
  interfaceId: string,
): LabNode | undefined {
  return document.nodes.find((node) =>
    node.interfaces.some((iface) => iface.id === interfaceId),
  );
}

function runningStateForNode(
  states: RuntimeState[],
  nodeId: string,
): RuntimeState | undefined {
  return states.find(
    (state) => state.nodeId === nodeId && state.status === "running",
  );
}

async function ensureRunningNodeTapTopology(
  labId: string,
  document: LabDocument,
  nodeId: string,
  runtime: RuntimeContext,
  deps: LiveTapSyncDependencies,
) {
  if (resolvedNetworkBackend(deps) === "socket" || !runtime.runCommand) {
    return;
  }

  const states = await (deps.listRuntimeStates ?? listRuntimeStates)(labId);
  const runningState = runningStateForNode(states, nodeId);
  if (
    !runningState ||
    (runningState.runtime !== "qemu" && runningState.runtime !== "cloud")
  ) {
    return;
  }

  const result = await (deps.ensureTapNetworking ?? ensureTapNetworking)(
    document,
    runtime.runCommand,
    deps.tapExists,
    nodeId,
    deps.isBridgeInterface,
  );

  if (!result.ok) {
    (deps.warn ?? defaultWarn)(`[network] ${result.message}`);
  }
}

function resolveCloudUplink(
  node: LabNode | undefined,
  deps: LiveTapSyncDependencies,
): string | null {
  if (!node) return null;
  return (
    node.config.bridgeInterface ??
    (deps.detectPhysicalNic ?? detectPhysicalNic)()
  );
}

async function detachInterfaceFromBridge(
  interfaceName: string | null,
  runtime: RuntimeContext,
  deps: LiveTapSyncDependencies,
) {
  if (
    resolvedNetworkBackend(deps) === "socket" ||
    !runtime.runCommand ||
    !interfaceName
  ) {
    return;
  }

  const result = await runtime.runCommand("ip", [
    "link",
    "set",
    "dev",
    interfaceName,
    "nomaster",
  ]);

  if (!result.ok) {
    (deps.warn ?? defaultWarn)(
      `[network] failed to detach ${interfaceName} from its bridge: ${result.stderr.trim() || "command failed"}`,
    );
  }
}

export async function syncRunningNodesForInterfaces(
  labId: string,
  document: LabDocument,
  interfaceIds: string[],
  runtime: RuntimeContext,
  deps: LiveTapSyncDependencies = {},
) {
  const nodeIds = [
    ...new Set(
      interfaceIds
        .map((interfaceId) => findNodeByInterfaceId(document, interfaceId)?.id)
        .filter((nodeId): nodeId is string => Boolean(nodeId)),
    ),
  ];

  for (const nodeId of nodeIds) {
    await ensureRunningNodeTapTopology(labId, document, nodeId, runtime, deps);
  }
}

export async function detachRunningInterfaceFromBridge(
  labId: string,
  document: LabDocument,
  interfaceId: string,
  runtime: RuntimeContext,
  deps: LiveTapSyncDependencies = {},
) {
  const node = findNodeByInterfaceId(document, interfaceId);
  if (!node) {
    return;
  }

  const states = await (deps.listRuntimeStates ?? listRuntimeStates)(labId);
  const runningState = runningStateForNode(states, node.id);
  if (!runningState) {
    return;
  }

  if (node.runtime === "qemu") {
    const iface = node.interfaces.find(
      (candidate) => candidate.id === interfaceId,
    );
    if (!iface) {
      return;
    }

    await detachInterfaceFromBridge(
      tapName(labId, node.id, iface.slot),
      runtime,
      deps,
    );
    return;
  }

  if (node.runtime === "cloud") {
    const uplink = resolveCloudUplink(node, deps);
    if (
      await shouldDetachCloudUplink(
        uplink,
        deps.isBridgeInterface ?? isLinuxBridgeInterface,
      )
    ) {
      await detachInterfaceFromBridge(uplink, runtime, deps);
    }
  }
}

export async function syncRunningCloudNodeBridgeInterface(
  labId: string,
  previousDocument: LabDocument,
  nextDocument: LabDocument,
  nodeId: string,
  runtime: RuntimeContext,
  deps: LiveTapSyncDependencies = {},
) {
  const previousNode = findNodeById(previousDocument, nodeId);
  const nextNode = findNodeById(nextDocument, nodeId);
  if (nextNode?.runtime !== "cloud") {
    return;
  }

  const states = await (deps.listRuntimeStates ?? listRuntimeStates)(labId);
  const runningState = runningStateForNode(states, nodeId);
  if (!runningState || runningState.runtime !== "cloud") {
    return;
  }

  const previousUplink = resolveCloudUplink(previousNode, deps);
  const nextUplink = resolveCloudUplink(nextNode, deps);
  if (
    previousUplink &&
    previousUplink !== nextUplink &&
    (await shouldDetachCloudUplink(
      previousUplink,
      deps.isBridgeInterface ?? isLinuxBridgeInterface,
    ))
  ) {
    await detachInterfaceFromBridge(previousUplink, runtime, deps);
  }

  const cloudInterfaceIds = new Set(
    nextNode.interfaces.map((iface) => iface.id),
  );
  const networkIds = new Set(
    nextDocument.attachments
      .filter((attachment) => cloudInterfaceIds.has(attachment.interfaceId))
      .map((attachment) => attachment.networkId),
  );
  const affectedInterfaceIds = nextDocument.attachments
    .filter((attachment) => networkIds.has(attachment.networkId))
    .map((attachment) => attachment.interfaceId);

  await syncRunningNodesForInterfaces(
    labId,
    nextDocument,
    affectedInterfaceIds,
    runtime,
    deps,
  );
}
