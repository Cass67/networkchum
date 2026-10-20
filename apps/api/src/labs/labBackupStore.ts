import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LabRecord } from "./labStore.js";
import { getDataDir } from "../storagePaths.js";

function backupRootDir(): string {
  return path.join(getDataDir(), "lab-backups");
}

function backupLabDir(labId: string): string {
  return path.join(backupRootDir(), labId);
}

export async function writeLabBackup(lab: LabRecord): Promise<void> {
  if (!lab.autoBackup) {
    return;
  }

  const dir = backupLabDir(lab.id);
  try {
    await mkdir(dir, { recursive: true });
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(path.join(dir, fileName), JSON.stringify(lab, null, 2));

    const backups = (await readdir(dir)).sort().reverse();
    const stale = backups.slice(10);
    await Promise.all(
      stale.map((name) => rm(path.join(dir, name), { force: true })),
    );
  } catch (error) {
    // A failed backup snapshot must not fail the lab mutation it accompanies;
    // surface it in the service log so the underlying cause gets fixed.
    console.error(
      `[lab-backup] snapshot failed for ${lab.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function listLabBackups(
  labId: string,
): Promise<Array<{ fileName: string }>> {
  const dir = backupLabDir(labId);
  try {
    const entries = (await readdir(dir)).sort().reverse();
    return entries.map((fileName) => ({ fileName }));
  } catch {
    return [];
  }
}

export async function readLabBackup(
  labId: string,
  fileName: string,
): Promise<LabRecord | null> {
  try {
    const raw = await readFile(
      path.join(backupLabDir(labId), fileName),
      "utf8",
    );
    return JSON.parse(raw) as LabRecord;
  } catch {
    return null;
  }
}
