import type {
  AiLabSpec,
  AiProviderSettings,
  ImageRecord,
  Template,
} from "@networkchum/shared";
import { AiLabSpecSchema } from "@networkchum/shared";
import { z } from "zod";

import { callLlm, type LlmMessage } from "./llmClient.js";
import { buildSystemPrompt } from "./systemPrompt.js";

/**
 * Pull the first balanced JSON object out of model output. Tolerates code
 * fences and surrounding prose; returns the raw text slice for schema
 * validation, which is the real gate.
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return null;
}

function formatSchemaErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function validateSpecShape(spec: AiLabSpec): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const node of spec.nodes) {
    if (names.has(node.name)) {
      errors.push(`duplicate node name "${node.name}"`);
    }
    names.add(node.name);
  }
  spec.links.forEach((link, index) => {
    for (const member of link.members) {
      if (!names.has(member.node)) {
        errors.push(`links[${index}] references unknown node "${member.node}"`);
      }
    }
  });
  return errors;
}

/**
 * Trim names, drop link members that reference unknown nodes, drop links
 * that end up with fewer than 2 members, and default link names. Deterministic
 * so the preview and the commit rebuild agree.
 */
function normalizeSpec(spec: AiLabSpec): AiLabSpec {
  const nodeNames = new Set(spec.nodes.map((node) => node.name));
  const links = spec.links
    .map((link) => ({
      name: link.name?.trim() || undefined,
      members: link.members
        .map((member) => ({ ...member, node: member.node.trim() }))
        .filter((member) => nodeNames.has(member.node)),
    }))
    .filter((link) => link.members.length >= 2)
    .map((link, index) => ({
      name: link.name ?? `link-${index + 1}`,
      members: link.members,
    }));
  return { ...spec, name: spec.name.trim(), links };
}

export function parseSpecJson(
  text: string,
): { ok: true; spec: AiLabSpec } | { ok: false; error: string } {
  const raw = extractJsonObject(text);
  if (!raw) {
    return { ok: false, error: "no JSON object found in the model output" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "invalid JSON",
    };
  }
  const result = AiLabSpecSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: formatSchemaErrors(result.error) };
  }
  const shapeErrors = validateSpecShape(result.data);
  if (shapeErrors.length > 0) {
    return { ok: false, error: shapeErrors.join("; ") };
  }
  return { ok: true, spec: normalizeSpec(result.data) };
}

export async function generateLabSpec(input: {
  prompt: string;
  settings: AiProviderSettings;
  templates: Template[];
  images: ImageRecord[];
  devices?: Array<string>;
  fetcher: typeof fetch;
  oauth?: { accountId?: string; orgId?: string; sessionId?: string };
}): Promise<{ spec: AiLabSpec; rounds: number }> {
  const system = buildSystemPrompt({
    templates: input.templates,
    images: input.images,
    devices: input.devices,
  });
  const messages: LlmMessage[] = [
    { role: "system", content: system },
    { role: "user", content: input.prompt },
  ];

  const text = await callLlm({
    settings: input.settings,
    messages,
    fetcher: input.fetcher,
    oauth: input.oauth,
  });
  let result = parseSpecJson(text);
  if (result.ok) {
    return { spec: result.spec, rounds: 1 };
  }

  // One repair round: show the model exactly what was wrong with its JSON.
  const repairMessages: LlmMessage[] = [
    ...messages,
    { role: "assistant", content: text },
    {
      role: "user",
      content: `Your output was not a valid lab spec. Errors: ${result.error}. Remember: respond with ONLY the JSON object from the output contract, every templateId copied verbatim from the device catalog, every link with at least 2 members that reference node names from your nodes list. Try again.`,
    },
  ];
  const repairedText = await callLlm({
    settings: input.settings,
    messages: repairMessages,
    fetcher: input.fetcher,
    oauth: input.oauth,
  });
  result = parseSpecJson(repairedText);
  if (result.ok) {
    return { spec: result.spec, rounds: 2 };
  }

  throw new Error(
    `The model did not return a valid lab spec after a repair round: ${result.error}`,
  );
}
