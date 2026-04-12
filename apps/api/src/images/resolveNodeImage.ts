import path from "node:path";

import { listImages } from "./imageStore.js";

export async function resolveNodeImagePath(
  imageIdOrPath: string | null | undefined,
): Promise<string | null> {
  if (!imageIdOrPath) {
    return null;
  }

  const images = await listImages();
  const byId = images.find((image) => image.id === imageIdOrPath);
  if (byId) {
    return byId.path;
  }

  if (path.isAbsolute(imageIdOrPath)) {
    return imageIdOrPath;
  }

  return null;
}
