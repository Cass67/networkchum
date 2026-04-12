import { rm } from "node:fs/promises";

import { getLabOverlaysDir, getNodeOverlayPath } from "../storagePaths.js";
import { powerOffNode } from "./powerNode.js";
import { deleteRuntimeState } from "./runtimeStateStore.js";

type CleanupDependencies = {
  powerOff?: (labId: string, nodeId: string) => Promise<unknown>;
};

const defaultDeps: Required<CleanupDependencies> = {
  powerOff: powerOffNode,
};

export async function cleanupNodeRuntime(
  labId: string,
  nodeId: string,
  deps: CleanupDependencies = defaultDeps,
): Promise<void> {
  await (deps.powerOff ?? defaultDeps.powerOff)(labId, nodeId);
  await deleteRuntimeState(labId, nodeId);
  await rm(getNodeOverlayPath(labId, nodeId), { force: true });
  await rm(getLabOverlaysDir(labId), { force: true }).catch(() => undefined);
}
