import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getDataDir, getDataFile } from "../storagePaths.js";
import type { NormalizedImportedTopology } from "./types.js";

export type ImportDraftRecord = {
  id: string;
  createdAt: string;
  topology: NormalizedImportedTopology;
};

function draftsFile(): string {
  return getDataFile("import-drafts.json");
}

async function listDrafts(): Promise<ImportDraftRecord[]> {
  try {
    const raw = await readFile(draftsFile(), "utf8");
    return JSON.parse(raw) as ImportDraftRecord[];
  } catch {
    return [];
  }
}

async function saveDrafts(drafts: ImportDraftRecord[]): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
  const tempPath = path.join(
    getDataDir(),
    `.import-drafts.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  await writeFile(tempPath, JSON.stringify(drafts, null, 2));
  await rename(tempPath, draftsFile());
}

export async function createImportDraft(
  topology: NormalizedImportedTopology,
): Promise<ImportDraftRecord> {
  const drafts = await listDrafts();
  const draft: ImportDraftRecord = {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    topology,
  };
  await saveDrafts([...drafts, draft]);
  return draft;
}

export async function getImportDraft(
  draftId: string,
): Promise<ImportDraftRecord | null> {
  const drafts = await listDrafts();
  return drafts.find((draft) => draft.id === draftId) ?? null;
}

export async function deleteImportDraft(draftId: string): Promise<void> {
  const drafts = await listDrafts();
  await saveDrafts(drafts.filter((draft) => draft.id !== draftId));
}

export async function pruneImportDrafts(
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  const drafts = await listDrafts();
  await saveDrafts(
    drafts.filter((draft) => Date.parse(draft.createdAt) >= cutoff),
  );
}
