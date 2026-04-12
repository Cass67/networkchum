import type { LabDocument } from "@networkchum/shared";

import { tapName } from "../runtime/qemu/buildQemuCommand.js";
import type { NetworkOperation } from "./types.js";

// Linux bridge names follow the same 15-char limit (IFNAMSIZ=16 including NUL).
// nc-br- (6) + last 8 alphanumeric chars of the networkId = 14 chars max.
function bridgeName(networkId: string): string {
  const clean = networkId.replace(/[^a-zA-Z0-9]/g, "");
  return `nc-br-${clean.slice(-8)}`;
}

export function reconcileTopology(document: LabDocument): NetworkOperation[] {
  const operations: NetworkOperation[] = [];

  for (const network of document.networks) {
    operations.push({
      kind: "create-bridge",
      bridgeName: bridgeName(network.id),
    });
    operations.push({
      kind: "set-interface-up",
      interfaceName: bridgeName(network.id),
    });
  }

  for (const attachment of document.attachments) {
    const node = document.nodes.find((n) =>
      n.interfaces.some((iface) => iface.id === attachment.interfaceId),
    );
    if (!node) continue;

    const iface = node.interfaces.find((i) => i.id === attachment.interfaceId);
    if (!iface) continue;

    const tap = tapName(document.id, node.id, iface.slot);

    operations.push({ kind: "create-tap", tapName: tap });
    operations.push({ kind: "set-interface-up", interfaceName: tap });
    operations.push({
      kind: "attach-to-bridge",
      interfaceName: tap,
      bridgeName: bridgeName(attachment.networkId),
    });
  }

  return operations;
}
