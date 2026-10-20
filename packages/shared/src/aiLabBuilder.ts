import { z } from "zod";

import { ImportIssueSchema } from "./importTopology.js";
import { LabDocumentSchema } from "./topology.js";

/**
 * Contract for the AI lab builder. The LLM only ever produces an
 * `AiLabSpec`; the API resolves it against the live device catalog and
 * validates the final `LabDocument` itself. See docs/agent-builder.md.
 */

export const AiProviderKindSchema = z.enum(["openai-compatible", "anthropic"]);
export type AiProviderKind = z.infer<typeof AiProviderKindSchema>;

export const AiProviderSettingsSchema = z.object({
  provider: AiProviderKindSchema,
  // openai-compatible: base URL including the version path, e.g.
  //   https://api.openai.com/v1  or  http://127.0.0.1:11434/v1
  // anthropic: base URL without the version path, e.g. https://api.anthropic.com
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  // Stored server-side in the API data dir; never returned to the browser.
  // null on save means "keep the previously stored key".
  apiKey: z.string().min(1).nullable(),
  temperature: z.number().min(0).optional(),
});
export type AiProviderSettings = z.infer<typeof AiProviderSettingsSchema>;

// What GET/PUT return: settings with the key omitted, plus whether one exists.
export const AiProviderSettingsViewSchema = AiProviderSettingsSchema.omit({
  apiKey: true,
}).extend({
  hasApiKey: z.boolean(),
});
export type AiProviderSettingsView = z.infer<
  typeof AiProviderSettingsViewSchema
>;

export const AiLabNodeSpecSchema = z.object({
  name: z.string().min(1),
  // Must be a templateId from the injected catalog; the API resolves fuzzy
  // matches deterministically and flags them as preview issues.
  templateId: z.string().min(1),
  role: z.string().optional(),
  interfaceCount: z.number().int().positive().optional(),
  vcpu: z.number().int().nonnegative().optional(),
  ramMb: z.number().int().nonnegative().optional(),
  // Raw day-0 startup config for the platform's inject method (e.g. IOS
  // config for cisco-iosv/cisco-asr, EOS config for arista-veos). Only
  // include for templates the catalog marks as supporting day-0 config.
  startupConfig: z.string().max(100_000).optional(),
});
export type AiLabNodeSpec = z.infer<typeof AiLabNodeSpecSchema>;

export const AiLabLinkMemberSchema = z.object({
  // References a node by name (names are unique within a spec).
  node: z.string().min(1),
  // Optional requested slot; the builder resolves collisions deterministically.
  interfaceIndex: z.number().int().nonnegative().optional(),
});
export type AiLabLinkMember = z.infer<typeof AiLabLinkMemberSchema>;

// One link = one ethernet broadcast segment shared by all members, matching
// the attachments flat edge-list model (one interface <-> one network).
export const AiLabLinkSpecSchema = z.object({
  name: z.string().optional(),
  members: z.array(AiLabLinkMemberSchema).min(2),
});
export type AiLabLinkSpec = z.infer<typeof AiLabLinkSpecSchema>;

export const AiLabSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(AiLabNodeSpecSchema).min(1),
  links: z.array(AiLabLinkSpecSchema).default(() => []),
});
export type AiLabSpec = z.infer<typeof AiLabSpecSchema>;

export const AiLabPreviewNodeSchema = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  // The template hint the model gave (may be fuzzy).
  requestedTemplate: z.string().min(1),
  status: z.enum(["matched", "fuzzy-matched", "unresolved"]),
  templateId: z.string().min(1).nullable(),
  displayName: z.string().min(1).nullable(),
  imageId: z.string().min(1).nullable(),
  imageBound: z.boolean(),
  interfaceCount: z.number().int().nonnegative().nullable(),
  // null when the template cannot inject a day-0 config at boot.
  configInjectMethod: z.string().min(1).nullable(),
  startupConfig: z.string().optional(),
  message: z.string().min(1).optional(),
});
export type AiLabPreviewNode = z.infer<typeof AiLabPreviewNodeSchema>;

export const AiLabPreviewLinkSchema = z.object({
  name: z.string().min(1),
  members: z.array(
    z.object({
      node: z.string().min(1),
      interfaceIndex: z.number().int().nonnegative(),
    }),
  ),
});
export type AiLabPreviewLink = z.infer<typeof AiLabPreviewLinkSchema>;

export const AiLabPreviewSchema = z.object({
  labName: z.string().min(1),
  description: z.string().optional(),
  spec: AiLabSpecSchema,
  nodes: z.array(AiLabPreviewNodeSchema),
  links: z.array(AiLabPreviewLinkSchema),
  issues: z.array(ImportIssueSchema),
  // null when any node is unresolved; commit is rejected in that case.
  document: LabDocumentSchema.nullable(),
});
export type AiLabPreview = z.infer<typeof AiLabPreviewSchema>;

export const AiLabCommitRequestSchema = z.object({
  name: z.string().trim().min(1),
  spec: AiLabSpecSchema,
  // Restrict resolution to the devices the user picked in the dialog; a spec
  // resolving outside this set is rejected at commit.
  allowedTemplateIds: z.array(z.string().min(1)).default(() => []),
});
export type AiLabCommitRequest = z.infer<typeof AiLabCommitRequestSchema>;
