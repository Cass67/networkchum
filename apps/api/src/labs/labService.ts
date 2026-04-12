import { cleanupNodeRuntime } from "../runtime/runtimeCleanupService.js";

import { createLab, getLab, removeLabRecord } from "./labStore.js";

type LabServiceDependencies = {
  cleanupNodeRuntime?: (labId: string, nodeId: string) => Promise<void>;
};

export async function createManagedLab(name: string) {
  return createLab(name);
}

export async function getManagedLab(labId: string) {
  return getLab(labId);
}

export async function deleteLab(
  labId: string,
  deps: LabServiceDependencies = {},
) {
  const lab = await getLab(labId);
  if (!lab) {
    return null;
  }

  const cleanup = deps.cleanupNodeRuntime ?? cleanupNodeRuntime;
  for (const node of lab.document.nodes) {
    await cleanup(labId, node.id);
  }

  await removeLabRecord(labId);
  return { labId };
}
