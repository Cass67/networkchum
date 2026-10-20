import { z } from "zod";

export const RuntimeKindSchema = z.enum([
  "qemu",
  "container",
  "cloud",
  "lab-bridge",
]);
export const DesiredPowerSchema = z.enum(["on", "off"]);
export const ContainerEngineSchema = z.enum(["docker", "podman"]);
export const CloudRoleSchema = z.enum([
  "management",
  "private-circuit",
  "isp-carrier",
]);

export const NodeInterfaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slot: z.number().int().nonnegative(),
});

function normalizeLegacyCloudBridge(
  bridgeInterface: string | null | undefined,
): { cloudRole: z.infer<typeof CloudRoleSchema>; bridgeGroup: string } | null {
  if (!bridgeInterface) {
    return null;
  }

  if (bridgeInterface === "br-mgmt" || bridgeInterface === "nc-mgmt") {
    return { cloudRole: "management", bridgeGroup: "management" };
  }

  const managedManagementMatch = bridgeInterface.match(/^nc-(?:mgmt|mg)-(.+)$/);
  if (managedManagementMatch?.[1]) {
    return {
      cloudRole: "management",
      bridgeGroup: managedManagementMatch[1],
    };
  }

  const privateMatch = bridgeInterface.match(/^nc-(?:priv|pv)-(.+)$/);
  if (privateMatch?.[1]) {
    return {
      cloudRole: "private-circuit",
      bridgeGroup: privateMatch[1],
    };
  }

  const carrierMatch = bridgeInterface.match(/^nc-(?:isp|is)-(.+)$/);
  if (carrierMatch?.[1]) {
    return {
      cloudRole: "isp-carrier",
      bridgeGroup: carrierMatch[1],
    };
  }

  return null;
}

function normalizeCloudConfig<
  T extends {
    bridgeInterface?: string | null;
    cloudRole?: z.infer<typeof CloudRoleSchema>;
    bridgeGroup?: string;
  },
>(config: T): T {
  const normalized = { ...config };

  if (normalized.cloudRole === "management" && !normalized.bridgeGroup) {
    normalized.bridgeGroup = "management";
  }

  const legacy = normalizeLegacyCloudBridge(normalized.bridgeInterface);
  if (!legacy) {
    return normalized;
  }

  if (!normalized.cloudRole) {
    normalized.cloudRole = legacy.cloudRole;
  }
  if (!normalized.bridgeGroup) {
    normalized.bridgeGroup = legacy.bridgeGroup;
  }

  return normalized;
}

export const NodeConfigSchema = z.object({
  vcpu: z.number().int().nonnegative(),
  ramMb: z.number().int().nonnegative(),
  interfaceCount: z.number().int().positive(),
  nicModel: z.string().min(1).optional(),
  accelerationMode: z.string().min(1).optional(),
  bridgeInterface: z.string().min(1).nullable().optional(),
  cloudRole: CloudRoleSchema.optional(),
  bridgeGroup: z.string().min(1).optional(),
  containerImageRef: z.string().min(1).optional(),
  containerRegistry: z.string().min(1).optional(),
  containerEngine: ContainerEngineSchema.optional(),
  containerShell: z.string().min(1).optional(),
  // lab-bridge nodes only: the other lab this bridge pairs with (both sides
  // must reference each other for the segment merge to apply).
  peerLabId: z.string().min(1).optional(),
});

export const LabNodeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    runtime: RuntimeKindSchema,
    templateId: z.string().min(1),
    imageId: z.string().min(1).nullable().optional(),
    position: z.object({ x: z.number(), y: z.number() }),
    config: NodeConfigSchema,
    state: z.object({ desiredPower: DesiredPowerSchema }),
    interfaces: z.array(NodeInterfaceSchema),
  })
  .transform((node) =>
    node.runtime === "cloud"
      ? {
          ...node,
          config: normalizeCloudConfig(node.config),
        }
      : node,
  );

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

const CanvasDrawingBaseSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
  zIndex: z.number().int().default(0),
});

export const CanvasShapeDrawingSchema = CanvasDrawingBaseSchema.extend({
  kind: z.literal("shape"),
  shape: z.enum(["rectangle", "square", "ellipse", "circle"]),
  fill: z.string().min(1),
  stroke: z.string().min(1),
});

export const CanvasImageDrawingSchema = CanvasDrawingBaseSchema.extend({
  kind: z.literal("image"),
  src: z.string().min(1),
});

export const CanvasTextDrawingSchema = CanvasDrawingBaseSchema.extend({
  kind: z.literal("text"),
  text: z.string().min(1),
  fill: z.string().min(1),
  fontSize: z.number().positive().default(22),
});

export const CanvasDrawingSchema = z.discriminatedUnion("kind", [
  CanvasShapeDrawingSchema,
  CanvasImageDrawingSchema,
  CanvasTextDrawingSchema,
]);

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
    drawings: z.array(CanvasDrawingSchema).default(() => []),
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
export type CanvasDrawing = z.infer<typeof CanvasDrawingSchema>;
export type StartupConfigSet = z.infer<typeof StartupConfigSetSchema>;
export type NodeBootAction = z.infer<typeof NodeBootActionSchema>;
export type CloudRole = z.infer<typeof CloudRoleSchema>;
export type NodeBootActionState = {
  nodeId: string;
  startupConfig: NodeBootAction;
  runningConfigBackup: NodeBootAction;
  updatedAt?: string;
};
