import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDataDir } from "../storagePaths.js";

export type RunningConfigBackupRecord = {
  id: string;
  labId: string;
  nodeId: string;
  status: "captured" | "failed" | "unsupported";
  source: string;
  createdAt: string;
  config?: string;
  error?: string;
};

function getBackupRoot(): string {
  return path.join(getDataDir(), "running-config-backups");
}

function getLabBackupDir(labId: string): string {
  return path.join(getBackupRoot(), labId);
}

function getNodeBackupFile(labId: string, nodeId: string): string {
  return path.join(getLabBackupDir(labId), `${nodeId}.json`);
}

async function ensureLabBackupDir(labId: string): Promise<void> {
  await mkdir(getLabBackupDir(labId), { recursive: true });
}

async function readRecords(labId: string, nodeId: string) {
  try {
    const raw = await readFile(getNodeBackupFile(labId, nodeId), "utf8");
    return JSON.parse(raw) as RunningConfigBackupRecord[];
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

async function writeRecords(
  labId: string,
  nodeId: string,
  records: RunningConfigBackupRecord[],
) {
  await ensureLabBackupDir(labId);
  await writeFile(
    getNodeBackupFile(labId, nodeId),
    JSON.stringify(records, null, 2),
  );
}

export async function appendRunningConfigBackupRecord(
  record: RunningConfigBackupRecord,
): Promise<void> {
  const records = await readRecords(record.labId, record.nodeId);
  records.push(record);
  await writeRecords(record.labId, record.nodeId, records);
}

export async function listRunningConfigBackupRecords(
  labId: string,
  nodeId: string,
): Promise<RunningConfigBackupRecord[]> {
  return readRecords(labId, nodeId);
}
