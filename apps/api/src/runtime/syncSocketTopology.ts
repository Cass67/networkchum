import { listLabs } from "../labs/labStore.js";
import { buildCloudRoleByNetworkId } from "../network/cloudUplink.js";
import type { CloudRole } from "@networkchum/shared";

import { getNetworkBackend } from "./hostCapabilities.js";
import { listRuntimeStates } from "./runtimeStateStore.js";
import { virtualSwitch, type VirtualSwitchAdapter } from "./virtualSwitch.js";

type SyncSocketTopologyDeps = {
  getNetworkBackend?: () => "tap" | "socket";
  listLabs?: typeof listLabs;
  listRuntimeStates?: typeof listRuntimeStates;
  switchAdapter?: VirtualSwitchAdapter;
};

export async function syncSocketTopology({
  getNetworkBackend: resolveNetworkBackend = getNetworkBackend,
  listLabs: loadLabs = listLabs,
  listRuntimeStates: loadRuntimeStates = listRuntimeStates,
  switchAdapter = virtualSwitch,
}: SyncSocketTopologyDeps = {}) {
  if (resolveNetworkBackend() !== "socket") {
    return { labs: 0, qemuNodes: 0, nics: 0, attachments: 0 };
  }

  const [labs, states] = await Promise.all([loadLabs(), loadRuntimeStates()]);
  switchAdapter.reset();

  let qemuNodes = 0;
  let nics = 0;

  const cloudRoleCache = new Map<
    string,
    {
      rolesByNetworkId: Map<string, CloudRole>;
      networkIdByInterfaceId: Map<string, string>;
    }
  >();

  for (const state of states) {
    if (
      state.status !== "running" ||
      state.runtime !== "qemu" ||
      !state.nicPorts?.length
    ) {
      continue;
    }

    const lab = labs.find((entry) => entry.id === state.labId);
    if (!lab) {
      continue;
    }

    const node = lab.document.nodes.find(
      (entry) => entry.id === state.nodeId && entry.runtime === "qemu",
    );
    if (!node) {
      continue;
    }

    qemuNodes += 1;

    // Legacy runtime states created before 24095ff may have nicPorts but no
    // nicBackends. In that case, infer management-backed NIC slots from the
    // *current* lab topology, matching powerOnNode()'s backend selection logic.
    let managementSlots: Set<number> | null = null;
    const needsManagementFallback =
      !state.nicBackends ||
      node.interfaces.some(
        (iface) => state.nicBackends?.[iface.slot] === undefined,
      );

    if (needsManagementFallback) {
      let cached = cloudRoleCache.get(lab.id);
      if (!cached) {
        cached = {
          rolesByNetworkId: buildCloudRoleByNetworkId(lab.document),
          networkIdByInterfaceId: new Map(
            lab.document.attachments.map((attachment) => [
              attachment.interfaceId,
              attachment.networkId,
            ]),
          ),
        };
        cloudRoleCache.set(lab.id, cached);
      }

      managementSlots = new Set<number>();
      for (const iface of node.interfaces) {
        const networkId = cached.networkIdByInterfaceId.get(iface.id);
        if (!networkId) continue;
        if (cached.rolesByNetworkId.get(networkId) === "management") {
          managementSlots.add(iface.slot);
        }
      }
    }

    for (const iface of node.interfaces) {
      const persistedBackend = state.nicBackends?.[iface.slot];
      if (persistedBackend === "macos-management") {
        continue;
      }

      // Only fall back to topology-derived management slots when the persisted
      // metadata is missing/incomplete. If the slot is explicitly stored as
      // null, preserve the persisted meaning (socket-backed).
      if (persistedBackend === undefined && managementSlots?.has(iface.slot)) {
        continue;
      }

      const port = state.nicPorts[iface.slot];
      if (port === undefined) {
        continue;
      }

      switchAdapter.addNic(iface.id, port);
      nics += 1;
    }
  }

  const attachments = labs.flatMap((lab) => lab.document.attachments);
  switchAdapter.syncAttachments(attachments);

  return {
    labs: labs.length,
    qemuNodes,
    nics,
    attachments: attachments.length,
  };
}
