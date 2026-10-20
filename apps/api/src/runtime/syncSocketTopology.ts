import { listLabs } from "../labs/labStore.js";
import { buildCloudRoleByNetworkId } from "../network/cloudUplink.js";
import type { CloudRole, LabNode } from "@networkchum/shared";

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

  // Lab bridges: merge broadcast domains across labs. A pair of labs is
  // fabric-linked when each side has a `lab-bridge` node whose config points
  // at the other lab; the merged group is every network attached to those
  // bridge nodes. Management (cloud uplink) networks are never merged.
  const fabricGroups: string[][] = [];
  {
    const bridgesByLab = new Map<string, LabNode[]>();
    const managementNetworks = new Map<string, Set<string>>();
    for (const lab of labs) {
      const roles = buildCloudRoleByNetworkId(lab.document);
      managementNetworks.set(
        lab.id,
        new Set(
          [...roles.entries()]
            .filter(([, role]) => role === "management")
            .map(([networkId]) => networkId),
        ),
      );
      bridgesByLab.set(
        lab.id,
        lab.document.nodes
          .filter((node) => node.runtime === "lab-bridge")
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    }

    const networksFor = (labId: string, node: LabNode): string[] => {
      const lab = labs.find((entry) => entry.id === labId);
      if (!lab) return [];
      const management = managementNetworks.get(labId) ?? new Set<string>();
      const networkIds = new Set<string>();
      for (const iface of node.interfaces) {
        const networkId = lab.document.attachments.find(
          (attachment) => attachment.interfaceId === iface.id,
        )?.networkId;
        if (networkId && !management.has(networkId)) {
          networkIds.add(networkId);
        }
      }
      return [...networkIds];
    };

    const seenPairs = new Set<string>();
    for (const [labId, bridges] of bridgesByLab) {
      for (const bridge of bridges) {
        const peerLabId = bridge.config.peerLabId;
        if (!peerLabId || peerLabId === labId) continue;
        const pairKey = [labId, peerLabId].sort().join("|");
        if (seenPairs.has(pairKey)) continue;
        const peerBridges = (bridgesByLab.get(peerLabId) ?? []).filter(
          (candidate) => candidate.config.peerLabId === labId,
        );
        if (peerBridges.length === 0) continue;
        seenPairs.add(pairKey);
        const group = [
          ...new Set([
            ...networksFor(labId, bridge),
            ...networksFor(peerLabId, peerBridges[0]!),
          ]),
        ];
        if (group.length >= 2) fabricGroups.push(group);
      }
    }
  }

  switchAdapter.setFabricGroups(fabricGroups);

  return {
    labs: labs.length,
    qemuNodes,
    nics,
    attachments: attachments.length,
  };
}
