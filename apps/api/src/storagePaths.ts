import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const apiRootDir = path.resolve(path.dirname(currentFilePath), "..");

export function getDataDir(): string {
  return process.env.NETWORKCHUM_DATA_DIR ?? path.join(apiRootDir, "data");
}

export function getDataFile(fileName: string): string {
  return path.join(getDataDir(), fileName);
}

export function getImagesDir(): string {
  return path.join(getDataDir(), "images");
}

export function getUploadedImagesDir(): string {
  return path.join(getImagesDir(), "uploads");
}

export function getLabOverlaysDir(labId: string): string {
  return path.join(getDataDir(), "overlays", labId);
}

export function getNodeOverlayPath(labId: string, nodeId: string): string {
  return path.join(getLabOverlaysDir(labId), `${nodeId}.qcow2`);
}

export function getNodeConfigDrivePath(
  labId: string,
  nodeId: string,
  ext: string,
): string {
  return path.join(getDataDir(), "configs", labId, `${nodeId}-startup.${ext}`);
}
