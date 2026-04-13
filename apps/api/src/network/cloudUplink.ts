import { access } from "node:fs/promises";

import type { LabDocument } from "@networkchum/shared";

import { detectPhysicalNic } from "./reconcileTopology.js";

export type BridgeInterfaceDetector = (
  interfaceName: string,
) => Promise<boolean>;

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

    const uplink = node.config.bridgeInterface ?? detectPhysicalNic();
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

export async function shouldDetachCloudUplink(
  interfaceName: string | null,
  isBridgeInterface: BridgeInterfaceDetector = isLinuxBridgeInterface,
): Promise<boolean> {
  if (!interfaceName) {
    return false;
  }

  return !(await isBridgeInterface(interfaceName));
}
