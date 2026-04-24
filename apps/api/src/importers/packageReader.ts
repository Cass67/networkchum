import path from "node:path";

import type { ImportFormat } from "@networkchum/shared";
import JSZip from "jszip";

import type { TopologyPayload, TopologyUpload } from "./types.js";

function extensionOf(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

function formatForPath(
  fileName: string,
  packageFileName?: string,
): ImportFormat | null {
  const ext = extensionOf(fileName);
  if (ext === ".unl") {
    return /pnet/i.test(packageFileName ?? fileName)
      ? "pnetlab-unl"
      : "eve-unl";
  }
  if (ext === ".gns3") {
    return packageFileName ? "gns3-project" : "gns3";
  }
  return null;
}

export async function readTopologyUpload(
  upload: TopologyUpload,
): Promise<TopologyPayload> {
  const directFormat = formatForPath(upload.fileName);
  if (directFormat) {
    return {
      format: directFormat,
      originalFileName: upload.fileName,
      topologyPath: upload.fileName,
      content: upload.content.toString("utf8"),
      ignoredFiles: [],
    };
  }

  const ext = extensionOf(upload.fileName);
  if (![".zip", ".gns3project", ".gns3p"].includes(ext)) {
    throw new Error(
      "Unsupported import file. Upload .unl, .gns3, .zip, .gns3project, or .gns3p.",
    );
  }

  const zip = await JSZip.loadAsync(upload.content);
  const files = Object.values(zip.files);
  const candidates = files.filter(
    (entry) =>
      !entry.dir && Boolean(formatForPath(entry.name, upload.fileName)),
  );

  if (candidates.length === 0) {
    throw new Error("Package does not contain a supported topology file.");
  }
  if (candidates.length > 1) {
    throw new Error(
      "Package contains multiple topology files. Import one lab at a time.",
    );
  }

  const entry = candidates[0]!;
  const format = formatForPath(entry.name, upload.fileName)!;
  return {
    format,
    originalFileName: upload.fileName,
    topologyPath: entry.name,
    content: await entry.async("text"),
    ignoredFiles: files
      .filter((file) => !file.dir && file.name !== entry.name)
      .map((file) => file.name),
  };
}
