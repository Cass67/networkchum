import type { ImageRecord, ImportPreview, Template } from "@networkchum/shared";

import { importedTemplateKey, normalizeKey } from "./normalize.js";
import type {
  NormalizedImportedNode,
  NormalizedImportedTopology,
} from "./types.js";

type BuildPreviewInput = {
  draftId: string;
  topology: NormalizedImportedTopology;
  templates: Template[];
  images: ImageRecord[];
};

const TEMPLATE_SYNONYMS = new Map<string, string>([
  ["vios", "cisco-iosv"],
  ["iosv", "cisco-iosv"],
  ["cisco-vios", "cisco-iosv"],
  ["csr1000v", "cisco-asr"],
  ["asr1000", "cisco-asr"],
  ["cisco-asr", "cisco-asr"],
  ["veos", "arista-veos"],
  ["arista-veos", "arista-veos"],
  ["vsrx", "juniper-vsrx"],
  ["juniper-vsrx", "juniper-vsrx"],
  ["nxosv", "cisco-nxosv"],
  ["nx-osv", "cisco-nxosv"],
]);

function templateLabel(template: Template, image?: ImageRecord | null): string {
  return image
    ? `${template.displayName} (${image.name})`
    : template.displayName;
}

function compatibleTemplates(
  node: NormalizedImportedNode,
  templates: Template[],
): Template[] {
  return templates.filter((template) => {
    if (!node.runtimeHint) return true;
    return template.runtime === node.runtimeHint;
  });
}

function matchTemplateByName(
  node: NormalizedImportedNode,
  templates: Template[],
): Template | null {
  const normalizedTemplate = normalizeKey(node.templateName);
  const synonymId = TEMPLATE_SYNONYMS.get(normalizedTemplate);
  if (synonymId) {
    return templates.find((template) => template.id === synonymId) ?? null;
  }

  return (
    templates.find((template) => {
      const values = [
        template.id,
        template.displayName,
        template.vendor,
        `${template.vendor} ${template.displayName}`,
      ].map(normalizeKey);
      return values.some(
        (value) =>
          value === normalizedTemplate ||
          (normalizedTemplate && value.includes(normalizedTemplate)),
      );
    }) ?? null
  );
}

function matchByImage(input: {
  node: NormalizedImportedNode;
  templates: Template[];
  images: ImageRecord[];
}): { template: Template; image: ImageRecord } | null {
  const imageKey = normalizeKey(input.node.imageName);
  if (!imageKey) return null;

  const image = input.images.find((entry) => {
    if (entry.catalogState !== "active" || !entry.templateId) return false;
    const nameKey = normalizeKey(entry.name);
    return nameKey === imageKey || nameKey.includes(imageKey);
  });
  if (!image?.templateId) return null;

  const template = input.templates.find(
    (entry) => entry.id === image.templateId,
  );
  return template ? { template, image } : null;
}

function candidatesForNode(input: {
  node: NormalizedImportedNode;
  templates: Template[];
  images: ImageRecord[];
}) {
  const seen = new Set<string>();
  const candidates = compatibleTemplates(input.node, input.templates).flatMap(
    (template) => {
      if (seen.has(template.id)) return [];
      seen.add(template.id);
      const boundImage = input.images.find(
        (image) =>
          image.catalogState === "active" && image.templateId === template.id,
      );
      return [
        {
          templateId: template.id,
          imageId: boundImage?.id ?? null,
          label: templateLabel(template, boundImage),
          reason: "Compatible runtime",
        },
      ];
    },
  );
  return candidates;
}

export function matchImportedNode(input: {
  node: NormalizedImportedNode;
  templates: Template[];
  images: ImageRecord[];
}) {
  const imageMatch = matchByImage(input);
  if (imageMatch) {
    return {
      template: imageMatch.template,
      image: imageMatch.image,
      candidates: candidatesForNode(input),
    };
  }

  const template = matchTemplateByName(input.node, input.templates);
  if (!template) {
    return {
      template: null,
      image: null,
      candidates: candidatesForNode(input),
    };
  }

  const image = input.images.find(
    (entry) =>
      entry.catalogState === "active" && entry.templateId === template.id,
  );
  return {
    template,
    image: image ?? null,
    candidates: candidatesForNode(input),
  };
}

export function buildImportPreview(input: BuildPreviewInput): ImportPreview {
  return {
    draftId: input.draftId,
    source: {
      format: input.topology.source.format,
      fileName: input.topology.source.fileName,
      topologyPath: input.topology.source.topologyPath,
    },
    labName: input.topology.name,
    summary: {
      nodes: input.topology.nodes.length,
      networks: input.topology.links.length,
      links: input.topology.links.length,
    },
    nodes: input.topology.nodes.map((node) => {
      const match = matchImportedNode({
        node,
        templates: input.templates,
        images: input.images,
      });
      return {
        foreignId: node.foreignId,
        name: node.name,
        templateKey: importedTemplateKey(node),
        requestedTemplate: node.templateName,
        requestedImage: node.imageName,
        status: match.template ? "matched" : "unresolved",
        matchedTemplateId: match.template?.id ?? null,
        matchedImageId: match.image?.id ?? null,
        candidates: match.candidates,
      };
    }),
    issues: input.topology.issues,
  };
}
