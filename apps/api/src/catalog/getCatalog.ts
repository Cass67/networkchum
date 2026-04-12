import type { CatalogEntry } from "@networkchum/shared";

import { listImages } from "../images/imageStore.js";
import { TemplateRegistry } from "../templates/templateRegistry.js";

export async function getCatalog(): Promise<CatalogEntry[]> {
  const registry = new TemplateRegistry();
  const templates = registry.list();
  const images = await listImages();

  const boundVmEntries = images.flatMap((image) => {
    if (!image.templateId || image.catalogState === "removed") {
      return [];
    }
    const template = registry.get(image.templateId);
    if (!template || template.runtime !== "qemu") {
      return [];
    }
    return [
      {
        id: `${template.id}:${image.id}`,
        template,
        image,
        source: "image-bound" as const,
      },
    ];
  });

  const boundTemplateIds = new Set(boundVmEntries.map((e) => e.template.id));

  // Include all VM templates even without a bound image so they appear in the
  // upload dialog dropdown and can be targeted before an image is uploaded.
  const unboundVmEntries = templates
    .filter(
      (template) =>
        template.runtime === "qemu" && !boundTemplateIds.has(template.id),
    )
    .map((template) => ({
      id: template.id,
      template,
      image: null,
      source: "built-in" as const,
    }));

  const containerEntries = templates
    .filter((template) => template.runtime === "container")
    .map((template) => ({
      id: template.id,
      template,
      image: null,
      source: "built-in" as const,
    }));

  return [...boundVmEntries, ...unboundVmEntries, ...containerEntries];
}
