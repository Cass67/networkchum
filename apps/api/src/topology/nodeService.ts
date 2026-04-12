import { getLab, updateLabDocument } from "../labs/labStore.js";
import { cleanupNodeRuntime } from "../runtime/runtimeCleanupService.js";

import { removeNode } from "./mutations.js";

type NodeServiceDependencies = {
  cleanupNodeRuntime?: (labId: string, nodeId: string) => Promise<void>;
};

export async function deleteNode(
  labId: string,
  nodeId: string,
  deps: NodeServiceDependencies = {},
) {
  const lab = await getLab(labId);
  if (!lab) {
    return null;
  }

  const node = lab.document.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    return null;
  }

  const cleanup = deps.cleanupNodeRuntime ?? cleanupNodeRuntime;
  await cleanup(labId, nodeId);

  return updateLabDocument(labId, removeNode(lab.document, nodeId));
}
