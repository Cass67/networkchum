import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ImageRecord } from "@networkchum/shared";

import { listImages, saveImages } from "./imageStore.js";

function suggestTemplateId(fileName: string): string | null {
  const lower = fileName.toLowerCase();

  if (lower.includes("csr1000v") || lower.includes("csr1000")) {
    return "cisco-asr";
  }
  if (lower.includes("asr") || lower.includes("iosxe")) {
    return "cisco-asr";
  }
  if (lower.includes("iosv") || lower.includes("vios")) {
    if (lower.includes("l2") || lower.includes("switch")) {
      return "cisco-vios-switch";
    }
    return "cisco-vios";
  }
  if (lower.includes("nxos") || lower.includes("nexus")) {
    return "cisco-nxosv";
  }
  if (lower.includes("xrv9k") || lower.includes("xrv9000")) {
    return "cisco-xrv9k";
  }
  if (lower.includes("xrv")) {
    return "cisco-xrv";
  }
  if (lower.includes("asav") || lower.includes("asa")) {
    return "cisco-asav";
  }
  if (lower.includes("ftd") || lower.includes("firepower")) {
    return "cisco-ftd";
  }
  if (lower.includes("c8000") || lower.includes("catalyst8000")) {
    return "cisco-catalyst-8000v";
  }
  if (
    lower.includes("cat9k") ||
    lower.includes("catalyst9000") ||
    lower.includes("c9kv")
  ) {
    return "cisco-catalyst-9000v";
  }
  if (lower.includes("ise")) {
    return "cisco-ise";
  }
  if (lower.includes("vsrx30") || lower.includes("vsrx3")) {
    return "juniper-vsrx30";
  }
  if (lower.includes("vsrxng") || lower.includes("vsrx-ng")) {
    return "juniper-vsrx-ng";
  }
  if (lower.includes("vsrx")) {
    return "juniper-vsrx";
  }
  if (lower.includes("vmxvfp") || lower.includes("vfp")) {
    return "juniper-vmx-vfp";
  }
  if (lower.includes("vmxvcp") || lower.includes("vcp")) {
    return "juniper-vmx-vcp";
  }
  if (lower.includes("vmx")) {
    return "juniper-vmx";
  }
  if (
    lower.includes("vqfxpfe") ||
    lower.includes("qfx-pfe") ||
    lower.includes("vqfxpfe")
  ) {
    return "juniper-vqfx-pfe";
  }
  if (
    lower.includes("vqfxre") ||
    lower.includes("qfx-re") ||
    lower.includes("vqfxre")
  ) {
    return "juniper-vqfx-re";
  }
  if (lower.includes("crpd") || lower.includes("c-rpd")) {
    return "juniper-crpd";
  }
  if (lower.includes("veos") || lower.includes("arista")) {
    return "arista-veos";
  }
  if (lower.includes("fortigate") || lower.includes("fortinet")) {
    return "fortinet-fortigate";
  }
  if (lower.includes("paloalto") || lower.includes("pan-")) {
    return "paloalto-vm";
  }
  if (lower.includes("pfsense")) {
    return "pfsense";
  }
  if (lower.includes("opnsense")) {
    return "opnsense";
  }
  if (lower.includes("vyos")) {
    return "vyos";
  }
  if (lower.includes("mikrotik") || lower.includes("routeros")) {
    return "mikrotik-routeros";
  }
  if (lower.includes("cumulus")) {
    return "cumulus-vx";
  }
  if (lower.includes("bigip") || lower.includes("f5")) {
    return "f5-bigip";
  }
  if (lower.includes("netscaler") || lower.includes("nsvpx")) {
    return "netscaler-vpx";
  }
  if (lower.includes("freebsd")) {
    return "freebsd";
  }
  if (lower.includes("alpine")) {
    return "linux-alpine-container";
  }
  if (lower.includes("ubuntu")) {
    return "linux-ubuntu-container";
  }

  return null;
}

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

export async function bindImageToTemplate(
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
}
