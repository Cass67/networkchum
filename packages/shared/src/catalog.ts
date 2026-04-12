import { z } from "zod";

import { RuntimeKindSchema } from "./topology.js";

const NumberLimitSchema = z.object({
  default: z.number().int().positive(),
  min: z.number().int().positive(),
  max: z.number().int().positive(),
});

export const TemplateSchema = z.object({
  id: z.string().min(1),
  runtime: RuntimeKindSchema,
  displayName: z.string().min(1),
  vendor: z.string().min(1),
  boot: z.object({
    console: z.enum(["serial", "vnc"]),
    machineType: z.string().min(1).optional(),
    nicModel: z.string().min(1).optional(),
    acceleration: z.string().min(1),
    configInjectMethod: z
      .enum(["cloud-init", "iosv-vfat", "csr1000v-vfat", "veos-flash", "none"])
      .optional(),
  }),
  configSchema: z.object({
    ramMb: NumberLimitSchema,
    vcpu: NumberLimitSchema,
    interfaceCount: NumberLimitSchema,
  }),
  interfaceNames: z.array(z.string()).optional(),
});

export const ImageRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  format: z.enum(["qcow2"]),
  sizeBytes: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
  templateId: z.string().min(1).nullable(),
  suggestedTemplateId: z.string().min(1).nullable().optional(),
  source: z.enum(["upload", "scan"]),
  catalogState: z.enum(["active", "removed"]),
});

export const CatalogEntrySchema = z.object({
  id: z.string().min(1),
  template: TemplateSchema,
  image: ImageRecordSchema.nullable(),
  source: z.enum(["built-in", "image-bound"]),
});

export type Template = z.infer<typeof TemplateSchema>;
export type ImageRecord = z.infer<typeof ImageRecordSchema>;
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
