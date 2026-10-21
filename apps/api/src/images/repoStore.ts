import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { ImageRepo } from "@networkchum/shared";
import { getDataDir, getDataFile } from "../storagePaths.js";

function reposFile(): string {
  return getDataFile("image-repos.json");
}

async function ensureStore(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

export async function listImageRepos(): Promise<ImageRepo[]> {
  try {
    const raw = await readFile(reposFile(), "utf8");
    return JSON.parse(raw) as ImageRepo[];
  } catch {
    return [];
  }
}

export async function saveImageRepos(repos: ImageRepo[]): Promise<void> {
  await ensureStore();
  await writeFile(reposFile(), JSON.stringify(repos, null, 2));
}

export async function getImageRepo(repoId: string): Promise<ImageRepo | null> {
  const repos = await listImageRepos();
  return repos.find((repo) => repo.id === repoId) ?? null;
}
