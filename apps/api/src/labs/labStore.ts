import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LabDocument } from "@networkchum/shared";
import { getDataDir, getDataFile } from "../storagePaths.js";

function labsFile(): string {
  return getDataFile("labs.json");
}

type LabRecord = {
  id: string;
  name: string;
  document: LabDocument;
  updatedAt: string;
  autoBackup?: boolean;
};

async function ensureStore(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

export async function listLabs(): Promise<LabRecord[]> {
  try {
    const raw = await readFile(labsFile(), "utf8");
    return JSON.parse(raw) as LabRecord[];
  } catch {
    return [];
  }
}

async function saveLabs(labs: LabRecord[]): Promise<void> {
  await enqueueStoreWrite(async () => {
    await ensureStore();
    const filePath = labsFile();
    const tempPath = path.join(
      getDataDir(),
      `.labs.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
    );
    await writeFile(tempPath, JSON.stringify(labs, null, 2));
    await rename(tempPath, filePath);
  });
}

let storeWriteQueue = Promise.resolve();

function enqueueStoreWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = storeWriteQueue.then(operation, operation);
  storeWriteQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function createLab(name: string): Promise<LabRecord> {
  const labs = await listLabs();
  const id = `lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const lab: LabRecord = {
    id,
    name,
    updatedAt: now,
    autoBackup: false,
    document: {
      id,
      name,
      version: 1,
      canvas: {
        zoom: 1,
        backgroundImage: null,
      },
      nodes: [],
      networks: [],
      attachments: [],
      annotations: [],
      startupConfigSets: [],
      nodeBootActions: [],
      activeConfigSetId: null,
    },
  };

  labs.push(lab);
  await saveLabs(labs);
  return lab;
}

export async function getLab(labId: string): Promise<LabRecord | null> {
  const labs = await listLabs();
  return labs.find((lab) => lab.id === labId) ?? null;
}

export async function updateLabDocument(
  labId: string,
  document: LabDocument,
): Promise<LabRecord | null> {
  const labs = await listLabs();
  const index = labs.findIndex((lab) => lab.id === labId);
  if (index === -1) {
    return null;
  }

  const nextLab: LabRecord = {
    ...labs[index],
    name: document.name,
    document,
    updatedAt: new Date().toISOString(),
  };
  labs[index] = nextLab;
  await saveLabs(labs);
  return nextLab;
}

export async function updateLabAutoBackup(
  labId: string,
  autoBackup: boolean,
): Promise<LabRecord | null> {
  const labs = await listLabs();
  const index = labs.findIndex((lab) => lab.id === labId);
  if (index === -1) {
    return null;
  }

  const nextLab: LabRecord = {
    ...labs[index],
    autoBackup,
    updatedAt: new Date().toISOString(),
  };
  labs[index] = nextLab;
  await saveLabs(labs);
  return nextLab;
}

export async function replaceLabRecord(
  labId: string,
  lab: LabRecord,
): Promise<LabRecord | null> {
  const labs = await listLabs();
  const index = labs.findIndex((entry) => entry.id === labId);
  if (index === -1) {
    return null;
  }

  const nextLab: LabRecord = {
    ...lab,
    id: labId,
    document: { ...lab.document, id: labId },
    updatedAt: new Date().toISOString(),
  };
  labs[index] = nextLab;
  await saveLabs(labs);
  return nextLab;
}

export async function removeLabRecord(labId: string): Promise<boolean> {
  const labs = await listLabs();
  const nextLabs = labs.filter((lab) => lab.id !== labId);
  if (nextLabs.length === labs.length) {
    return false;
  }

  await saveLabs(nextLabs);
  return true;
}

export type { LabRecord };
