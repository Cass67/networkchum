import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ImageRecord } from "@networkchum/shared";

import { getUploadedImagesDir } from "../storagePaths.js";
import { listImages, saveImages } from "./imageStore.js";

type UploadImageInput = {
  fileName: string;
  content: Buffer;
};

function sanitizeImageName(fileName: string): string {
  return path.basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function createImageId(fileName: string): string {
  return `img-${Date.now()}-${fileName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
}

export function createImageService() {
  return {
    async listImages(): Promise<ImageRecord[]> {
      return listImages();
    },

    async getImage(imageId: string): Promise<ImageRecord | null> {
      const images = await listImages();
      return images.find((image) => image.id === imageId) ?? null;
    },

    async uploadImage(input: UploadImageInput): Promise<ImageRecord> {
      const safeFileName = sanitizeImageName(input.fileName);
      const targetPath = path.join(getUploadedImagesDir(), safeFileName);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, input.content);

      const images = await listImages();
      const image: ImageRecord = {
        id: createImageId(safeFileName),
        name: safeFileName,
        path: targetPath,
        format: "qcow2",
        sizeBytes: input.content.byteLength,
        updatedAt: new Date().toISOString(),
        templateId: null,
        suggestedTemplateId: null,
        source: "upload",
        catalogState: "active",
      };

      await saveImages([...images, image]);
      return image;
    },

    async bindImageToTemplate(
      imageId: string,
      templateId: string,
    ): Promise<ImageRecord | null> {
      const images = await listImages();
      const image = images.find((entry) => entry.id === imageId);
      if (!image) {
        return null;
      }

      image.templateId = templateId;
      await saveImages(images);
      return image;
    },

    async unbindImageFromTemplate(
      imageId: string,
    ): Promise<ImageRecord | null> {
      const images = await listImages();
      const image = images.find((entry) => entry.id === imageId);
      if (!image) {
        return null;
      }

      image.templateId = null;
      await saveImages(images);
      return image;
    },

    async removeImageFromCatalog(imageId: string): Promise<ImageRecord | null> {
      const images = await listImages();
      const image = images.find((entry) => entry.id === imageId);
      if (!image) {
        return null;
      }

      image.catalogState = "removed";
      image.templateId = null;
      await saveImages(images);
      return image;
    },

    async deleteImageFile(imageId: string): Promise<ImageRecord | null> {
      const images = await listImages();
      const index = images.findIndex((entry) => entry.id === imageId);
      if (index === -1) {
        return null;
      }

      const [image] = images.splice(index, 1);
      await rm(image!.path, { force: true });
      await saveImages(images);
      return image ?? null;
    },
  };
}
