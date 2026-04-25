import { z } from "zod";

export const ImportFormatSchema = z.enum([
  "eve-unl",
  "pnetlab-unl",
  "gns3",
  "gns3-project",
]);

export const ImportIssueSchema = z.object({
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  nodeName: z.string().min(1).optional(),
});

export const ImportCandidateSchema = z.object({
  templateId: z.string().min(1),
  imageId: z.string().min(1).nullable().optional(),
  label: z.string().min(1),
  reason: z.string().min(1).optional(),
});

export const ImportPreviewNodeSchema = z.object({
  foreignId: z.string().min(1),
  name: z.string().min(1),
  templateKey: z.string().min(1),
  requestedTemplate: z.string().min(1).nullable(),
  requestedImage: z.string().min(1).nullable(),
  status: z.enum(["matched", "unresolved"]),
  matchedTemplateId: z.string().min(1).nullable().optional(),
  matchedImageId: z.string().min(1).nullable().optional(),
  candidates: z.array(ImportCandidateSchema),
});

export const ImportPreviewSchema = z.object({
  draftId: z.string().min(1),
  source: z.object({
    format: ImportFormatSchema,
    fileName: z.string().min(1),
    topologyPath: z.string().min(1).optional(),
  }),
  labName: z.string().min(1),
  summary: z.object({
    nodes: z.number().int().nonnegative(),
    networks: z.number().int().nonnegative(),
    links: z.number().int().nonnegative(),
  }),
  nodes: z.array(ImportPreviewNodeSchema),
  issues: z.array(ImportIssueSchema),
});

export const ImportMappingSchema = z.object({
  templateKey: z.string().min(1),
  templateId: z.string().min(1),
  imageId: z.string().min(1).nullable().optional(),
});

export const ImportCommitRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
  mappings: z.array(ImportMappingSchema).default(() => []),
  excludedNodeIds: z.array(z.string().min(1)).default(() => []),
});

export type ImportFormat = z.infer<typeof ImportFormatSchema>;
export type ImportIssue = z.infer<typeof ImportIssueSchema>;
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
export type ImportPreviewNode = z.infer<typeof ImportPreviewNodeSchema>;
export type ImportCandidate = z.infer<typeof ImportCandidateSchema>;
export type ImportMapping = z.infer<typeof ImportMappingSchema>;
export type ImportCommitRequest = z.infer<typeof ImportCommitRequestSchema>;
