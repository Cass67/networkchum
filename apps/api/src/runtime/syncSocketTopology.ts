import { listLabs } from "../labs/labStore.js";

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

    for (const iface of node.interfaces) {
      if (state.nicBackends?.[iface.slot] === "macos-management") {
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
