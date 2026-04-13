import os from "node:os";

import type { LabDocument } from "@networkchum/shared";

import { tapName } from "../runtime/qemu/buildQemuCommand.js";
import type { NetworkOperation } from "./types.js";

export function listHostInterfaces(): string[] {
  const interfaces = os.networkInterfaces();
  return Object.entries(interfaces)
    .filter(([name, addresses]) => {
      if (!addresses?.length) return false;
      if (/^(lo|docker|br-|virbr|veth|tap|tun|utun|gif|stf|anpi)/i.test(name)) {
        return false;
      }

      return addresses.some((address) => !address.internal);
    })
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}

export function detectPhysicalNic(): string | null {
  const candidates = ["eth0", "ens192", "ens33", "enp3s0", "enp0s3", "en0"];
  const available = new Set(listHostInterfaces());
  for (const nic of candidates) {
    if (available.has(nic)) {
      return nic;
    }
  }

  return listHostInterfaces()[0] ?? null;
}

// Linux bridge names follow the same 15-char limit (IFNAMSIZ=16 including NUL).
// nc-br- (6) + last 8 alphanumeric chars of the networkId = 14 chars max.
export function bridgeName(networkId: string): string {
  const clean = networkId.replace(/[^a-zA-Z0-9]/g, "");
  return `nc-br-${clean.slice(-8)}`;
}

export function reconcileTopology(
  document: LabDocument,
  targetNodeId?: string,
  bridgeTargets: ReadonlyMap<string, string> = new Map(),
): NetworkOperation[] {
  const operations: NetworkOperation[] = [];

  for (const network of document.networks) {
    if (bridgeTargets.has(network.id)) {
      continue;
    }

    operations.push({
      kind: "create-bridge",
      bridgeName: bridgeName(network.id),
    });
    operations.push({
      kind: "set-interface-up",
      interfaceName: bridgeName(network.id),
    });
  }

  const attachmentByInterfaceId = new Map(
    document.attachments.map((attachment) => [
      attachment.interfaceId,
      attachment,
    ]),
  );

  for (const node of document.nodes) {
    if (node.runtime !== "qemu") continue;
    if (targetNodeId && node.id !== targetNodeId) continue;

    for (const iface of node.interfaces) {
      const tap = tapName(document.id, node.id, iface.slot);

      operations.push({ kind: "create-tap", tapName: tap });
      operations.push({ kind: "set-interface-up", interfaceName: tap });

      const attachment = attachmentByInterfaceId.get(iface.id);
      if (!attachment) continue;

      operations.push({
        kind: "attach-to-bridge",
        interfaceName: tap,
        bridgeName:
          bridgeTargets.get(attachment.networkId) ??
          bridgeName(attachment.networkId),
      });
    }
  }

  return operations;
}
