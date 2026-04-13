import { z } from "zod";

import { ContainerEngineSchema, RuntimeKindSchema } from "./topology.js";

export const ContainerTemplateConfigSchema = z.object({
  imageRef: z.string().min(1),
  registry: z.string().min(1),
  engine: ContainerEngineSchema.optional(),
  defaultShell: z.string().min(1).optional(),
});

export const DeviceRoleIconSchema = z.enum([
  "router",
  "switch",
  "firewall",
  "cloud",
  "host",
  "client",
]);

const NumberLimitSchema = z.object({
  default: z.number().int().nonnegative(),
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
});

export const TemplateSchema = z.object({
  id: z.string().min(1),
  runtime: RuntimeKindSchema,
  displayName: z.string().min(1),
  vendor: z.string().min(1),
  deviceRoleIcon: DeviceRoleIconSchema,
  boot: z.object({
    console: z.enum(["serial", "vnc", "none"]),
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
  container: ContainerTemplateConfigSchema.optional(),
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
export type ContainerEngine = z.infer<typeof ContainerEngineSchema>;
export type ContainerTemplateConfig = z.infer<
  typeof ContainerTemplateConfigSchema
>;
