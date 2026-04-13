import { access, readdir } from "node:fs/promises";

import type { CloudRole, LabDocument, LabNode } from "@networkchum/shared";

export type BridgeInterfaceDetector = (
  interfaceName: string,
) => Promise<boolean>;

type ResolvedCloudBridge = {
  cloudRole: CloudRole;
  bridgeGroup: string;
  bridgeName: string;
};

function cloudBridgeRequirementMessage(
  nodeName: string,
  reason: string,
): string {
  return `Cloud node '${nodeName}' is missing valid bridge settings: ${reason}. Choose a cloud role and bridge group so NetworkChum can create or reuse the managed bridge automatically.`;
}

export async function isLinuxBridgeInterface(
  interfaceName: string,
): Promise<boolean> {
  try {
    await access(`/sys/class/net/${interfaceName}/bridge`);
    return true;
  } catch {
    return false;
  }
}

export async function listLinuxBridgeInterfaces(): Promise<string[]> {
  try {
    const interfaceNames = await readdir("/sys/class/net");
    const results = await Promise.all(
      interfaceNames.map(async (interfaceName) => ({
        interfaceName,
        isBridge: await isLinuxBridgeInterface(interfaceName),
      })),
    );

    return results
      .filter((entry) => entry.isBridge)
      .map((entry) => entry.interfaceName)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

function normalizeLegacyBridgeInterface(
  bridgeInterface: string | null | undefined,
): Pick<ResolvedCloudBridge, "cloudRole" | "bridgeGroup"> | null {
  if (!bridgeInterface) {
    return null;
  }

  if (bridgeInterface === "br-mgmt" || bridgeInterface === "nc-mgmt") {
    return {
      cloudRole: "management",
      bridgeGroup: "management",
    };
  }

  const managementMatch = bridgeInterface.match(/^nc-(?:mgmt|mg)-(.+)$/);
  if (managementMatch?.[1]) {
    return {
      cloudRole: "management",
      bridgeGroup: managementMatch[1],
    };
  }

  const privateMatch = bridgeInterface.match(/^nc-(?:priv|pv)-(.+)$/);
  if (privateMatch?.[1]) {
    return {
      cloudRole: "private-circuit",
      bridgeGroup: privateMatch[1],
    };
  }

  const carrierMatch = bridgeInterface.match(/^nc-(?:isp|is)-(.+)$/);
  if (carrierMatch?.[1]) {
    return {
      cloudRole: "isp-carrier",
      bridgeGroup: carrierMatch[1],
    };
  }

  return null;
}

function sanitizeBridgeGroupToken(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "") || "group";
}

export function managedBridgeNameFor(
  cloudRole: CloudRole,
  bridgeGroup: string,
): string {
  const token = sanitizeBridgeGroupToken(bridgeGroup);
  if (cloudRole === "management" && token === "management") {
    return "nc-mgmt";
  }

  switch (cloudRole) {
    case "management":
      return `nc-mg-${token.slice(0, 9)}`;
    case "private-circuit":
      return `nc-pv-${token.slice(0, 9)}`;
    case "isp-carrier":
      return `nc-is-${token.slice(0, 9)}`;
  }
}

export function resolveCloudBridge(
  node: Pick<LabNode, "config" | "runtime">,
): ResolvedCloudBridge | null {
  if (node.runtime !== "cloud") {
    return null;
  }

  const legacy = normalizeLegacyBridgeInterface(node.config.bridgeInterface);
  const cloudRole = node.config.cloudRole ?? legacy?.cloudRole;
  const bridgeGroup =
    node.config.bridgeGroup ??
    legacy?.bridgeGroup ??
    (cloudRole === "management" ? "management" : undefined);

  if (!cloudRole || !bridgeGroup) {
    return null;
  }

  return {
    cloudRole,
    bridgeGroup,
    bridgeName: managedBridgeNameFor(cloudRole, bridgeGroup),
  };
}

export async function buildBridgeTargetByNetworkId(
  document: LabDocument,
  _isBridgeInterface: BridgeInterfaceDetector = isLinuxBridgeInterface,
): Promise<Map<string, string>> {
  const attachmentByInterfaceId = new Map(
    document.attachments.map((attachment) => [
      attachment.interfaceId,
      attachment.networkId,
    ]),
  );

  const targets = new Map<string, string>();

  for (const node of document.nodes) {
    if (node.runtime !== "cloud") continue;

    const resolvedBridge = resolveCloudBridge(node);
    if (!resolvedBridge) {
      continue;
    }

    for (const iface of node.interfaces) {
      const networkId = attachmentByInterfaceId.get(iface.id);
      if (!networkId || targets.has(networkId)) continue;
      targets.set(networkId, resolvedBridge.bridgeName);
    }
  }

  return targets;
}

export async function validateCloudBridgeTargets(
  document: LabDocument,
  targetNodeId: string | undefined,
  isBridgeInterface: BridgeInterfaceDetector = isLinuxBridgeInterface,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const attachmentByInterfaceId = new Map(
    document.attachments.map((attachment) => [
      attachment.interfaceId,
      attachment.networkId,
    ]),
  );

  const relevantNetworkIds = new Set<string>();
  const scopedNodes = targetNodeId
    ? document.nodes.filter((node) => node.id === targetNodeId)
    : document.nodes;

  for (const node of scopedNodes) {
    for (const iface of node.interfaces) {
      const networkId = attachmentByInterfaceId.get(iface.id);
      if (networkId) {
        relevantNetworkIds.add(networkId);
      }
    }
  }

  for (const node of document.nodes) {
    if (node.runtime !== "cloud") continue;

    const attachedToRelevantNetwork = node.interfaces.some((iface) => {
      const networkId = attachmentByInterfaceId.get(iface.id);
      return networkId ? relevantNetworkIds.has(networkId) : false;
    });
    if (!attachedToRelevantNetwork) {
      continue;
    }

    const resolvedBridge = resolveCloudBridge(node);
    if (!resolvedBridge) {
      const hasCloudRole =
        Boolean(node.config.cloudRole) ||
        Boolean(normalizeLegacyBridgeInterface(node.config.bridgeInterface));
      const reason = hasCloudRole
        ? "a bridge group is required for this cloud role"
        : "a cloud role and bridge group are required";
      return {
        ok: false,
        message: cloudBridgeRequirementMessage(node.name, reason),
      };
    }
  }

  return { ok: true };
}

export async function shouldDetachCloudUplink(
  interfaceName: string | null,
  isBridgeInterface: BridgeInterfaceDetector = isLinuxBridgeInterface,
): Promise<boolean> {
  if (!interfaceName) {
    return false;
  }

  if (/^nc-(mgmt|mg-|pv-|is-)/.test(interfaceName)) {
    return false;
  }

  return !(await isBridgeInterface(interfaceName));
}
