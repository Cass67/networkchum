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

  const attachmentByInterfaceId = new Map(
    document.attachments.map((attachment) => [
      attachment.interfaceId,
      attachment,
    ]),
  );

  for (const node of document.nodes) {
    if (node.runtime !== "qemu") continue;

    for (const iface of node.interfaces) {
      const tap = tapName(document.id, node.id, iface.slot);

      operations.push({ kind: "create-tap", tapName: tap });
      operations.push({ kind: "set-interface-up", interfaceName: tap });

      const attachment = attachmentByInterfaceId.get(iface.id);
      if (!attachment) continue;

      operations.push({
        kind: "attach-to-bridge",
        interfaceName: tap,
        bridgeName: bridgeName(attachment.networkId),
      });
    }
  }

  return operations;
}
