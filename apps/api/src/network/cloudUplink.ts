import { access, readdir } from "node:fs/promises";

import type { LabDocument } from "@networkchum/shared";

export type BridgeInterfaceDetector = (
  interfaceName: string,
) => Promise<boolean>;

function cloudBridgeRequirementMessage(
  nodeName: string,
  uplink: string | null,
): string {
  const suffix = uplink
    ? ` '${uplink}' is not a Linux bridge.`
    : " no host bridge is configured.";
  return `Cloud node '${nodeName}' must use a pre-existing Linux bridge when TAP networking is enabled;${suffix} Create a host bridge such as 'br-mgmt', move the host uplink under it, then select that bridge in NetworkChum.`;
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

export async function buildBridgeTargetByNetworkId(
  document: LabDocument,
  isBridgeInterface: BridgeInterfaceDetector = isLinuxBridgeInterface,
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

    const uplink = node.config.bridgeInterface ?? null;
    if (!uplink || !(await isBridgeInterface(uplink))) {
      continue;
    }

    for (const iface of node.interfaces) {
      const networkId = attachmentByInterfaceId.get(iface.id);
      if (!networkId || targets.has(networkId)) continue;
      targets.set(networkId, uplink);
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

    const uplink = node.config.bridgeInterface ?? null;
    if (!uplink || !(await isBridgeInterface(uplink))) {
      return {
        ok: false,
        message: cloudBridgeRequirementMessage(node.name, uplink),
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

  return !(await isBridgeInterface(interfaceName));
}
