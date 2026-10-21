import type {
  AiProviderSettings,
  ImageRecord,
  Template,
} from "@networkchum/shared";
import { z } from "zod";

import { callLlm } from "./llmClient.js";
import { extractJsonObject } from "./generateLabSpec.js";

const ClassificationSchema = z.object({
  imageId: z.string().min(1),
  templateId: z.string().min(1),
  ramMb: z.number().int().positive().optional(),
  vcpu: z.number().int().positive().optional(),
  reason: z.string().optional(),
});

const ClassifierOutputSchema = z.object({
  classifications: z.array(ClassificationSchema),
});

export type ImageClassification = {
  imageId: string;
  templateId: string;
  ramMb: number | null;
  vcpu: number | null;
  reason: string | null;
};

function clampIntoRange(
  value: number,
  range: Template["configSchema"]["ramMb"],
) {
  return Math.min(range.max, Math.max(range.min, value));
}

function formatTemplates(templates: Template[]): string {
  return templates
    .filter((template) => template.runtime === "qemu")
    .map(
      (template) =>
        `- id=${template.id} | ${template.displayName} | vendor=${template.vendor} | ` +
        `ramMb default=${template.configSchema.ramMb.default} (min=${template.configSchema.ramMb.min}, max=${template.configSchema.ramMb.max}) | ` +
        `vcpu default=${template.configSchema.vcpu.default} (min=${template.configSchema.vcpu.min}, max=${template.configSchema.vcpu.max})`,
    )
    .join("\n");
}

function formatImages(images: ImageRecord[]): string {
  return images
    .map(
      (image) =>
        `- imageId=${image.id} | name=${image.name} | ` +
        `sizeMB=${Math.max(1, Math.round(image.sizeBytes / (1024 * 1024)))} | ` +
        `nameGuess=${image.suggestedTemplateId ?? "none"}`,
    )
    .join("\n");
}

/**
 * Ask the configured LLM to identify which template each image belongs to and
 * the hardware it needs. Deterministic inputs in, validated output out: only
 * known image/template ids survive, and hardware values are clamped into the
 * picked template's resource bounds. Anything the model gets wrong is dropped
 * rather than applied.
 */
export async function classifyImages(input: {
  settings: AiProviderSettings;
  images: ImageRecord[];
  templates: Template[];
  fetcher: typeof fetch;
}): Promise<ImageClassification[]> {
  const { settings, images, templates, fetcher } = input;
  const knownImageIds = new Set(images.map((image) => image.id));
  const knownTemplates = new Map(
    templates.map((template) => [template.id, template]),
  );

  const system = [
    "You classify virtual machine disk images for a network lab.",
    "For each image, pick exactly one template id from the catalog below —",
    "the template that best matches the vendor/OS the image name implies.",
    "Also state the RAM (MB) and vCPU count that image realistically needs,",
    "inside that template's bounds. If nothing fits, use template id",
    "generic-vm. Never replace a vendor-specific nameGuess with generic-vm:",
    "vendor images need their vendor profile to boot correctly.",
    "Respond with JSON only:",
    '{"classifications":[{"imageId":"...","templateId":"...","ramMb":2048,"vcpu":1,"reason":"short reason"}]}',
  ].join("\n");

  const user = [
    "Template catalog (pick templateId only from these ids):",
    formatTemplates(templates),
    "",
    "Images to classify:",
    formatImages(images),
  ].join("\n");

  const text = await callLlm({
    settings,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    fetcher,
    maxTokens: 2048,
  });

  const raw = extractJsonObject(text);
  if (!raw) {
    throw new Error("no JSON object found in the model output");
  }

  const parsed = ClassifierOutputSchema.parse(JSON.parse(raw));

  const results: ImageClassification[] = [];
  const seen = new Set<string>();
  for (const classification of parsed.classifications) {
    if (!knownImageIds.has(classification.imageId)) {
      continue;
    }
    if (seen.has(classification.imageId)) {
      continue;
    }
    // The filename heuristic is a deterministic vendor match; the model may
    // not downgrade it to the generic baseline, or the image would boot as an
    // anonymous VM instead of getting its vendor profile (e.g. Junos Evolved
    // images must land on juniper-vrr, not generic-vm).
    let templateId = classification.templateId;
    const nameGuess = images.find(
      (image) => image.id === classification.imageId,
    )?.suggestedTemplateId;
    if (
      templateId === "generic-vm" &&
      nameGuess &&
      nameGuess !== "generic-vm" &&
      knownTemplates.has(nameGuess)
    ) {
      templateId = nameGuess;
    }
    const template = knownTemplates.get(templateId);
    if (!template) {
      continue;
    }
    seen.add(classification.imageId);
    results.push({
      imageId: classification.imageId,
      templateId: template.id,
      ramMb:
        classification.ramMb !== undefined
          ? clampIntoRange(classification.ramMb, template.configSchema.ramMb)
          : null,
      vcpu:
        classification.vcpu !== undefined
          ? clampIntoRange(classification.vcpu, template.configSchema.vcpu)
          : null,
      reason: classification.reason?.trim() || null,
    });
  }
  return results;
}
