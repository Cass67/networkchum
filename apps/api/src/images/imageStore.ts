import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { ImageRecord } from "@networkchum/shared";
import { getDataDir, getDataFile } from "../storagePaths.js";

function imagesFile(): string {
  return getDataFile("images.json");
}

async function ensureStore(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

export async function listImages(): Promise<ImageRecord[]> {
  try {
    const raw = await readFile(imagesFile(), "utf8");
    return JSON.parse(raw) as ImageRecord[];
  } catch {
    return [];
  }
}

export async function saveImages(images: ImageRecord[]): Promise<void> {
  await ensureStore();
  await writeFile(imagesFile(), JSON.stringify(images, null, 2));
}

export async function getImage(imageId: string): Promise<ImageRecord | null> {
  const images = await listImages();
  return images.find((image) => image.id === imageId) ?? null;
}
