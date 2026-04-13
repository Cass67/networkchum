import { z } from "zod";

export const RuntimeKindSchema = z.enum(["qemu", "container", "cloud"]);
export const DesiredPowerSchema = z.enum(["on", "off"]);

export const NodeInterfaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slot: z.number().int().nonnegative(),
});

export const NodeConfigSchema = z.object({
  vcpu: z.number().int().nonnegative(),
  ramMb: z.number().int().nonnegative(),
  interfaceCount: z.number().int().positive(),
  nicModel: z.string().min(1).optional(),
  accelerationMode: z.string().min(1).optional(),
  bridgeInterface: z.string().min(1).nullable().optional(),
});

export const LabNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  runtime: RuntimeKindSchema,
  templateId: z.string().min(1),
  imageId: z.string().min(1).nullable().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  config: NodeConfigSchema,
  state: z.object({ desiredPower: DesiredPowerSchema }),
  interfaces: z.array(NodeInterfaceSchema),
});

export const NetworkSegmentSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["ethernet"]),
  name: z.string().min(1),
  visible: z.boolean(),
});

export const AttachmentSchema = z.object({
  interfaceId: z.string().min(1),
  networkId: z.string().min(1),
});

export const AnnotationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["text"]),
  text: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
});

export const StartupConfigSetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nodeConfigs: z.array(
    z.object({
      nodeId: z.string().min(1),
      config: z.string(),
    }),
  ),
});

export const NodeBootActionSchema = z.enum(["none", "once", "always"]);

const NodeBootActionStateV2Schema = z
  .object({
    nodeId: z.string().min(1),
    startupConfig: NodeBootActionSchema.default("none"),
    runningConfigBackup: NodeBootActionSchema.default("none"),
    updatedAt: z.string().min(1).optional(),
  })
  .strict();

const LegacyNodeBootActionStateSchema = z
  .object({
    nodeId: z.string().min(1),
    action: z.enum(["none", "backup-once", "inject-once"]),
    updatedAt: z.string().min(1).optional(),
  })
  .strict();

export const NodeBootActionStateSchema = z
  .union([LegacyNodeBootActionStateSchema, NodeBootActionStateV2Schema])
  .transform((value) => {
    if ("action" in value) {
      return {
        nodeId: value.nodeId,
        startupConfig: value.action === "inject-once" ? "once" : "none",
        runningConfigBackup: value.action === "backup-once" ? "once" : "none",
        updatedAt: value.updatedAt,
      };
    }

    return value;
  });

export const LabDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  canvas: z.object({
    zoom: z.number().positive(),
    backgroundImage: z.string().nullable(),
  }),
  nodes: z.array(LabNodeSchema),
  networks: z.array(NetworkSegmentSchema),
  attachments: z.array(AttachmentSchema),
  annotations: z.array(AnnotationSchema),
  startupConfigSets: z.array(StartupConfigSetSchema),
  nodeBootActions: z.array(NodeBootActionStateSchema).default(() => []),
  activeConfigSetId: z.string().min(1).nullable(),
});

export type LabDocument = z.infer<typeof LabDocumentSchema>;
export type LabNode = z.infer<typeof LabNodeSchema>;
export type Attachment = z.infer<typeof AttachmentSchema>;
export type StartupConfigSet = z.infer<typeof StartupConfigSetSchema>;
export type NodeBootAction = z.infer<typeof NodeBootActionSchema>;
export type NodeBootActionState = {
  nodeId: string;
  startupConfig: NodeBootAction;
  runningConfigBackup: NodeBootAction;
  updatedAt?: string;
};
