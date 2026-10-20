import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ImageRecord } from "@networkchum/shared";
import { suggestTemplateId } from "@networkchum/shared";

import { listImages, saveImages } from "./imageStore.js";

export async function scanImages(imageDir: string): Promise<ImageRecord[]> {
  const dirEntries = await readdir(imageDir, { withFileTypes: true });
  const previousImages = await listImages();
  const previousByPath = new Map(
    previousImages.map((image) => [image.path, image]),
  );
  const nextImages: ImageRecord[] = [];

  for (const entry of dirEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".qcow2")) {
      continue;
    }

    const filePath = path.join(imageDir, entry.name);
    const details = await stat(filePath);
    const previous = previousByPath.get(filePath);
    const suggestedTemplateId = suggestTemplateId(entry.name);
    nextImages.push({
      id:
        previous?.id ??
        `img-${entry.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`,
      name: entry.name,
      path: filePath,
      format: "qcow2",
      sizeBytes: details.size,
      updatedAt: details.mtime.toISOString(),
      templateId: previous?.templateId ?? suggestedTemplateId ?? null,
      suggestedTemplateId,
      source: previous?.source ?? "scan",
      catalogState: previous?.catalogState ?? "active",
    });
  }

  // Preserve images registered from other directories (e.g. manually scanned paths)
  // so that bindings aren't wiped when the startup scan runs over data/images/.
  // Only keep entries whose files still exist — this drops stale test artifacts.
  const otherImageCandidates = previousImages.filter(
    (img) => path.dirname(img.path) !== imageDir,
  );
  const otherImages = (
    await Promise.all(
      otherImageCandidates.map(async (img) => {
        try {
          await stat(img.path);
          return img;
        } catch {
          return null;
        }
      }),
    )
  ).filter((img): img is ImageRecord => img !== null);

  await saveImages([...otherImages, ...nextImages]);
  return nextImages;
}
