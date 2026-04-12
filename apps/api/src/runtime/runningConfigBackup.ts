import { randomUUID } from "node:crypto";

import {
  appendRunningConfigBackupRecord,
  type RunningConfigBackupRecord,
} from "./runningConfigBackupStore.js";
import {
  findSupportingAdapter,
  type RunningConfigBackupAdapter,
} from "./runningConfigBackupAdapters.js";

export type RunningConfigBackupCoordinatorParams = {
  labId: string;
  nodeId: string;
  source: string;
  adapters?: RunningConfigBackupAdapter[];
};

export async function coordinateRunningConfigBackup({
  labId,
  nodeId,
  source,
  adapters = [],
}: RunningConfigBackupCoordinatorParams): Promise<RunningConfigBackupRecord> {
  const baseRecord = {
    id: randomUUID(),
    labId,
    nodeId,
    source,
    createdAt: new Date().toISOString(),
  };

  try {
    const adapter = await findSupportingAdapter(adapters, labId, nodeId);

    if (!adapter) {
      const unsupportedRecord: RunningConfigBackupRecord = {
        ...baseRecord,
        status: "unsupported",
      };
      await appendRunningConfigBackupRecord(unsupportedRecord);
      return unsupportedRecord;
    }

    const config = await adapter.capture(labId, nodeId);
    const capturedRecord: RunningConfigBackupRecord = {
      ...baseRecord,
      status: "captured",
      config,
    };
    await appendRunningConfigBackupRecord(capturedRecord);
    return capturedRecord;
  } catch (error) {
    const failedRecord: RunningConfigBackupRecord = {
      ...baseRecord,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
    await appendRunningConfigBackupRecord(failedRecord);
    return failedRecord;
  }
}
