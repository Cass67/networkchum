import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  CanvasDrawingSchema,
  CloudRoleSchema,
  NodeBootActionSchema,
} from "@networkchum/shared";

import {
  listLabs,
  replaceLabRecord,
  updateLabAutoBackup,
  updateLabDocument,
} from "../labs/labStore.js";
import {
  listLabBackups,
  readLabBackup,
  writeLabBackup,
} from "../labs/labBackupStore.js";
import { virtualSwitch } from "../runtime/virtualSwitch.js";
import {
  createManagedLab,
  deleteLab,
  getManagedLab,
} from "../labs/labService.js";
import { getNodeAttachmentsForContainer } from "../network/dockerNetworking.js";
import { deleteCable } from "../network/cableService.js";
import {
  detachRunningInterfaceFromBridge,
  syncRunningCloudNodeBridgeInterface,
  syncRunningNodesForInterfaces,
} from "../network/liveTapTopology.js";
import { detectAccelerationMode } from "../runtime/hostCapabilities.js";
import { powerOffNode, powerOnNode } from "../runtime/powerNode.js";
import { syncSocketTopology } from "../runtime/syncSocketTopology.js";
import { reconcileRuntimeStates } from "../runtime/reconcileRuntimeStates.js";
import { listRuntimeStates } from "../runtime/runtimeStateStore.js";
import { listRunningConfigBackupRecords } from "../runtime/runningConfigBackupStore.js";
import {
  addNetwork,
  addNode,
  attachInterfaces,
  deleteStartupConfigSet,
  detachInterface,
  moveNode,
  moveNodes,
  renameNode,
  removeNodeConfig,
  setCanvasDrawings,
  setActiveConfigSet,
  setNodeBootActions,
  setCloudNodeBridgeGroup,
  setNodeConfig,
  upsertStartupConfigSet,
} from "../topology/mutations.js";
import { deleteNode } from "../topology/nodeService.js";
import { TemplateRegistry } from "../templates/templateRegistry.js";
import { listImages } from "../images/imageStore.js";
import type { AppDependencies } from "../app.js";
import { listLinuxBridgeInterfaces } from "../network/cloudUplink.js";

const createLabSchema = z.object({
  name: z.string().min(1),
});

const renameLabSchema = z.object({
  name: z.string().trim().min(1),
});

const renameNodeSchema = z.object({
  name: z.string().trim().min(1),
});

const addNodeSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  imageId: z.string().min(1).nullable().optional(),
  interfaceCount: z.number().int().min(1).optional(),
  cloudRole: CloudRoleSchema.optional(),
  bridgeGroup: z.string().trim().min(1).nullable().optional(),
});

const createContainerNodeSchema = z.object({
  imageRef: z.string().trim().min(1),
  registry: z.string().trim().min(1).default("docker-hub"),
  engine: z.enum(["docker", "podman"]).optional(),
  shell: z.string().trim().min(1).optional(),
  displayName: z.string().trim().min(1).optional(),
  vendor: z.string().trim().min(1).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

const addNetworkSchema = z.object({
  name: z.string().min(1),
  visible: z.boolean().default(false),
});

const attachSchema = z.object({
  networkId: z.string().min(1),
  interfaceIds: z.array(z.string().min(1)).min(1),
});

const setNodeBootActionSchema = z.object({
  startupConfig: NodeBootActionSchema,
  runningConfigBackup: NodeBootActionSchema,
});

const setNodeSettingsSchema = z.object({
  cloudRole: CloudRoleSchema.optional(),
  bridgeGroup: z.string().trim().min(1).nullable().optional(),
});

const setCanvasDrawingsSchema = z.object({
  drawings: z.array(CanvasDrawingSchema),
});

const moveNodesSchema = z.object({
  moves: z.array(
    z.object({
      nodeId: z.string().min(1),
      position: z.object({ x: z.number(), y: z.number() }),
    }),
  ),
});

export const labRoutes: FastifyPluginAsync<AppDependencies> = async (
  app,
  options,
) => {
  const registry = new TemplateRegistry();

  const consoleBusyMessage = "Serial console already in use by another client.";

  async function listExternalConsoleClientPids(consolePort: number) {
    const runCommand = options.runtime?.runCommand;
    if (!runCommand) {
      return [];
    }

    const result = await runCommand("lsof", ["-nP", `-iTCP:${consolePort}`]);
    if (!result.ok) {
      return [];
    }

    return result.stdout
      .split("\n")
      .filter((line) => /ESTABLISHED/.test(line) && !/qemu-syst/.test(line))
      .map((line) => line.trim().split(/\s+/)[1])
      .filter((pid): pid is string => Boolean(pid));
  }

  async function enrichRuntimeStates(labId: string) {
    const runCommand = options.runtime?.runCommand;
    const states = runCommand
      ? await reconcileRuntimeStates(labId, runCommand)
      : await listRuntimeStates(labId);
    if (!runCommand) {
      return states.map((state) => ({ ...state, consoleInUse: false }));
    }

    return Promise.all(
      states.map(async (state) => {
        if (state.runtime !== "qemu" || !state.consolePort) {
          return { ...state, consoleInUse: false };
        }

        const consoleInUse =
          (await listExternalConsoleClientPids(state.consolePort)).length > 0;

        return {
          ...state,
          consoleInUse,
          message: consoleInUse ? consoleBusyMessage : state.message,
        };
      }),
    );
  }

  function resolveCloudRoleAndGroup(input: {
    nodeName: string;
    cloudRole?: z.infer<typeof CloudRoleSchema>;
    bridgeGroup?: string | null;
    currentCloudRole?: z.infer<typeof CloudRoleSchema>;
    currentBridgeGroup?: string;
  }):
    | {
        ok: true;
        cloudRole: z.infer<typeof CloudRoleSchema>;
        bridgeGroup: string;
      }
    | { ok: false; message: string } {
    const cloudRole = input.cloudRole ?? input.currentCloudRole ?? "management";
    const roleChanged =
      input.cloudRole !== undefined &&
      input.cloudRole !== input.currentCloudRole;
    const requestedBridgeGroup = input.bridgeGroup?.trim() || null;
    const currentBridgeGroup = input.currentBridgeGroup?.trim() || null;

    if (cloudRole === "management") {
      return {
        ok: true,
        cloudRole,
        bridgeGroup: requestedBridgeGroup ?? currentBridgeGroup ?? "management",
      };
    }

    const bridgeGroup =
      requestedBridgeGroup ?? (roleChanged ? null : currentBridgeGroup);
    if (!bridgeGroup) {
      return {
        ok: false,
        message: `Cloud node '${input.nodeName}' requires a bridge group for the '${cloudRole}' role.`,
      };
    }

    return { ok: true, cloudRole, bridgeGroup };
  }

  app.get("/labs", async () => ({ labs: await listLabs() }));

  app.get("/host/interfaces", async () => ({
    interfaces: await (
      options.runtime?.listHostInterfaces ?? listLinuxBridgeInterfaces
    )(),
  }));

  app.post("/labs", async (request, reply) => {
    const body = createLabSchema.parse(request.body);
    const lab = await createManagedLab(body.name);
    return reply.code(201).send({ lab });
  });

  app.delete("/labs/:labId", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const result = await deleteLab(params.labId);
    if (!result) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    await syncSocketTopology();
    return reply.send(result);
  });

  app.get("/labs/:labId", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    return reply.send({ lab });
  });

  app.patch("/labs/:labId", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = renameLabSchema.parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const updatedLab = await updateLabDocument(params.labId, {
      ...lab.document,
      name: body.name,
    });

    if (updatedLab) {
      await writeLabBackup(updatedLab);
    }

    return reply.send({ lab: updatedLab });
  });

  app.patch("/labs/:labId/auto-backup", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = z.object({ autoBackup: z.boolean() }).parse(request.body);
    const lab = await updateLabAutoBackup(params.labId, body.autoBackup);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    return reply.send({ lab });
  });

  app.get("/labs/:labId/backups", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    return reply.send({ backups: await listLabBackups(params.labId) });
  });

  app.get(
    "/labs/:labId/nodes/:nodeId/running-config-backups",
    async (request, reply) => {
      const params = z
        .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
        .parse(request.params);
      return reply.send({
        backups: await listRunningConfigBackupRecords(
          params.labId,
          params.nodeId,
        ),
      });
    },
  );

  app.post("/labs/:labId/restore-backup", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = z.object({ fileName: z.string().min(1) }).parse(request.body);
    const restored = await readLabBackup(params.labId, body.fileName);
    if (!restored) {
      return reply.code(404).send({ message: "Backup not found" });
    }

    const lab = await replaceLabRecord(params.labId, restored);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    return reply.send({ lab });
  });

  app.post("/labs/:labId/nodes", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = addNodeSchema.parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const template = registry.get(body.templateId);
    if (!template) {
      return reply.code(404).send({ message: "Template not found" });
    }

    const cloudSettings =
      template.runtime === "cloud"
        ? resolveCloudRoleAndGroup({
            nodeName: body.name,
            cloudRole: body.cloudRole,
            bridgeGroup: body.bridgeGroup,
          })
        : null;
    if (cloudSettings && !cloudSettings.ok) {
      return reply.code(400).send({ message: cloudSettings.message });
    }

    const acceleration = await detectAccelerationMode();
    let resolvedImageId = body.imageId;
    if (!resolvedImageId && template.runtime === "qemu") {
      const images = await listImages();
      const boundImage = images.find(
        (img) =>
          img.templateId === body.templateId && img.catalogState === "active",
      );
      resolvedImageId = boundImage?.id ?? null;
    }
    const document = addNode(lab.document, {
      template,
      name: body.name,
      position: body.position,
      imageId: resolvedImageId,
      interfaceCount: body.interfaceCount,
      cloudRole: cloudSettings?.ok ? cloudSettings.cloudRole : undefined,
      bridgeGroup: cloudSettings?.ok ? cloudSettings.bridgeGroup : undefined,
      accelerationMode:
        template.runtime === "qemu"
          ? acceleration.mode
          : template.boot.acceleration,
    });
    const updatedLab = await updateLabDocument(params.labId, document);
    if (updatedLab) {
      await writeLabBackup(updatedLab);
    }

    return reply.code(201).send({ lab: updatedLab });
  });

  app.post("/labs/:labId/container-nodes", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = createContainerNodeSchema.parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const template =
      registry.get("linux-alpine-container") ??
      registry.get("linux-ubuntu-container");
    if (!template || template.runtime !== "container") {
      return reply
        .code(500)
        .send({ message: "Container base template is not available" });
    }

    const position = body.position ?? {
      x: 120 + lab.document.nodes.length * 36,
      y: 100 + lab.document.nodes.length * 24,
    };
    const displayName =
      body.displayName?.trim() ||
      body.imageRef.split("/").filter(Boolean).at(-1)?.split(":")[0] ||
      "container";

    const document = addNode(lab.document, {
      template,
      name: displayName,
      position,
      containerImageRef: body.imageRef,
      containerRegistry: body.registry,
      containerEngine: body.engine,
      containerShell: body.shell,
    });
    const updatedLab = await updateLabDocument(params.labId, document);
    if (updatedLab) {
      await writeLabBackup(updatedLab);
    }

    return reply.code(201).send({ lab: updatedLab });
  });

  app.post("/labs/:labId/networks", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = addNetworkSchema.parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const document = addNetwork(lab.document, body);
    const updatedLab = await updateLabDocument(params.labId, document);
    if (updatedLab) {
      await writeLabBackup(updatedLab);
    }
    const network = updatedLab?.document.networks.at(-1);
    return reply.code(201).send({ network, lab: updatedLab });
  });

  app.post("/labs/:labId/attachments", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = attachSchema.parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    let document;
    try {
      document = attachInterfaces(lab.document, body);
    } catch (error) {
      if (error instanceof Error && /already attached/i.test(error.message)) {
        return reply.code(409).send({ message: error.message });
      }
      throw error;
    }
    const updatedLab = await updateLabDocument(params.labId, document);
    if (updatedLab) {
      await writeLabBackup(updatedLab);
      await syncRunningNodesForInterfaces(
        params.labId,
        updatedLab.document,
        body.interfaceIds,
        options.runtime ?? {},
      );
    }
    if (updatedLab) {
      await syncSocketTopology();
    }
    return reply.code(201).send({ lab: updatedLab });
  });

  app.patch("/labs/:labId/canvas/drawings", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = setCanvasDrawingsSchema.parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const document = setCanvasDrawings(lab.document, body.drawings);
    const updatedLab = await updateLabDocument(params.labId, document);
    if (updatedLab) {
      await writeLabBackup(updatedLab);
    }
    return reply.send({ lab: updatedLab });
  });

  app.patch("/labs/:labId/nodes/:nodeId/position", async (request, reply) => {
    const params = z
      .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
      .parse(request.params);
    const body = z.object({ x: z.number(), y: z.number() }).parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const document = moveNode(lab.document, params.nodeId, body);
    const updatedLab = await updateLabDocument(params.labId, document);
    if (updatedLab) {
      await writeLabBackup(updatedLab);
    }
    return reply.send({ lab: updatedLab });
  });

  app.patch("/labs/:labId/nodes/positions", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = moveNodesSchema.parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const document = moveNodes(lab.document, body.moves);
    const updatedLab = await updateLabDocument(params.labId, document);
    if (updatedLab) {
      await writeLabBackup(updatedLab);
    }
    return reply.send({ lab: updatedLab });
  });

  app.patch("/labs/:labId/nodes/:nodeId", async (request, reply) => {
    const params = z
      .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
      .parse(request.params);
    const body = renameNodeSchema.parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const nodeExists = lab.document.nodes.some(
      (node) => node.id === params.nodeId,
    );
    if (!nodeExists) {
      return reply.code(404).send({ message: "Node not found" });
    }

    const document = renameNode(lab.document, params.nodeId, body.name);
    const updatedLab = await updateLabDocument(params.labId, document);
    if (updatedLab) {
      await writeLabBackup(updatedLab);
    }
    return reply.send({ lab: updatedLab });
  });

  app.patch(
    "/labs/:labId/nodes/:nodeId/boot-action",
    async (request, reply) => {
      const params = z
        .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
        .parse(request.params);
      let body: z.infer<typeof setNodeBootActionSchema>;
      try {
        body = setNodeBootActionSchema.parse(request.body);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return reply
            .code(400)
            .send({ message: error.message, issues: error.issues });
        }
        throw error;
      }
      const lab = await getManagedLab(params.labId);
      if (!lab) {
        return reply.code(404).send({ message: "Lab not found" });
      }

      const nodeExists = lab.document.nodes.some(
        (node) => node.id === params.nodeId,
      );
      if (!nodeExists) {
        return reply.code(404).send({ message: "Node not found" });
      }

      const document = setNodeBootActions(lab.document, params.nodeId, body);
      const updatedLab = await updateLabDocument(params.labId, document);
      if (updatedLab) {
        await writeLabBackup(updatedLab);
      }
      return reply.send({ lab: updatedLab });
    },
  );

  app.patch("/labs/:labId/nodes/:nodeId/settings", async (request, reply) => {
    const params = z
      .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
      .parse(request.params);
    let body: z.infer<typeof setNodeSettingsSchema>;
    try {
      body = setNodeSettingsSchema.parse(request.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply
          .code(400)
          .send({ message: error.message, issues: error.issues });
      }
      throw error;
    }
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const nodeExists = lab.document.nodes.some(
      (node) => node.id === params.nodeId,
    );
    if (!nodeExists) {
      return reply.code(404).send({ message: "Node not found" });
    }

    const node = lab.document.nodes.find((entry) => entry.id === params.nodeId);
    if (!node || node.runtime !== "cloud") {
      return reply.code(400).send({
        message: "Cloud settings can only be updated for cloud nodes",
      });
    }

    const cloudSettings = resolveCloudRoleAndGroup({
      nodeName: node.name,
      cloudRole: body.cloudRole,
      bridgeGroup: body.bridgeGroup,
      currentCloudRole: node.config.cloudRole,
      currentBridgeGroup: node.config.bridgeGroup,
    });
    if (!cloudSettings.ok) {
      return reply.code(400).send({ message: cloudSettings.message });
    }

    const document = setCloudNodeBridgeGroup(
      lab.document,
      params.nodeId,
      cloudSettings.cloudRole,
      cloudSettings.bridgeGroup,
    );
    const updatedLab = await updateLabDocument(params.labId, document);
    if (updatedLab) {
      await writeLabBackup(updatedLab);
      await syncRunningCloudNodeBridgeInterface(
        params.labId,
        lab.document,
        updatedLab.document,
        params.nodeId,
        options.runtime ?? {},
      );
    }
    return reply.send({ lab: updatedLab });
  });

  app.delete(
    "/labs/:labId/attachments/:interfaceId",
    async (request, reply) => {
      const params = z
        .object({ labId: z.string().min(1), interfaceId: z.string().min(1) })
        .parse(request.params);
      const lab = await getManagedLab(params.labId);
      if (!lab) {
        return reply.code(404).send({ message: "Lab not found" });
      }

      const document = detachInterface(lab.document, params.interfaceId);
      const updatedLab = await updateLabDocument(params.labId, document);
      if (updatedLab) {
        void writeLabBackup(updatedLab);
        await detachRunningInterfaceFromBridge(
          params.labId,
          lab.document,
          params.interfaceId,
          options.runtime ?? {},
        );
      }
      if (updatedLab) {
        await syncSocketTopology();
      }
      return reply.send({ lab: updatedLab });
    },
  );

  app.delete("/labs/:labId/nodes/:nodeId", async (request, reply) => {
    const params = z
      .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
      .parse(request.params);
    const lab = await deleteNode(params.labId, params.nodeId);
    if (!lab) {
      return reply.code(404).send({ message: "Node not found" });
    }

    await syncSocketTopology();
    return reply.send({ lab });
  });

  app.delete("/labs/:labId/networks/:networkId", async (request, reply) => {
    const params = z
      .object({ labId: z.string().min(1), networkId: z.string().min(1) })
      .parse(request.params);
    const existingLab = await getManagedLab(params.labId);
    if (!existingLab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const detachedInterfaceIds = existingLab.document.attachments
      .filter((attachment) => attachment.networkId === params.networkId)
      .map((attachment) => attachment.interfaceId);
    const lab = await deleteCable(params.labId, params.networkId);
    if (!lab) {
      return reply.code(404).send({ message: "Network not found" });
    }

    for (const interfaceId of detachedInterfaceIds) {
      await detachRunningInterfaceFromBridge(
        params.labId,
        existingLab.document,
        interfaceId,
        options.runtime ?? {},
      );
    }

    await syncSocketTopology();
    return reply.send({ lab });
  });

  app.get("/labs/:labId/runtime", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    return reply.send({ states: await enrichRuntimeStates(params.labId) });
  });

  app.post("/labs/:labId/nodes/:nodeId/power-on", async (request, reply) => {
    const params = z
      .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
      .parse(request.params);
    const state = await powerOnNode(
      params.labId,
      params.nodeId,
      options.runtime,
    );
    if (!state) {
      return reply.code(404).send({ message: "Node not found" });
    }

    return reply.send({ state });
  });

  app.post("/labs/:labId/nodes/:nodeId/power-off", async (request, reply) => {
    const params = z
      .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
      .parse(request.params);
    const state = await powerOffNode(
      params.labId,
      params.nodeId,
      options.runtime,
    );
    return reply.send({ state });
  });

  app.post(
    "/labs/:labId/nodes/:nodeId/disconnect-console",
    async (request, reply) => {
      const params = z
        .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
        .parse(request.params);
      const state = (await listRuntimeStates(params.labId)).find(
        (entry) => entry.nodeId === params.nodeId,
      );
      if (!state || state.runtime !== "qemu" || !state.consolePort) {
        return reply.code(404).send({ message: "Console not found" });
      }

      const runCommand = options.runtime?.runCommand;
      const clientPids = await listExternalConsoleClientPids(state.consolePort);
      if (runCommand && clientPids.length > 0) {
        await runCommand("kill", clientPids);
      }

      return reply.send({ killedPids: clientPids });
    },
  );

  app.post("/labs/:labId/nodes/:nodeId/detach", async (request, reply) => {
    const params = z
      .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
      .parse(request.params);
    const lab = await getManagedLab(params.labId);
    if (!lab) {
      return reply.code(404).send({ message: "Lab not found" });
    }

    const attachments = getNodeAttachmentsForContainer(
      lab.document,
      params.nodeId,
    );
    return reply.send({
      nodeId: params.nodeId,
      networks: attachments.map((a) => a.networkId),
    });
  });

  // --- Startup config sets ---

  app.post("/labs/:labId/config-sets", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = z.object({ name: z.string().min(1) }).parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) return reply.code(404).send({ message: "Lab not found" });

    const set = {
      id: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: body.name,
      nodeConfigs: [],
    };
    const updatedLab = await updateLabDocument(
      params.labId,
      upsertStartupConfigSet(lab.document, set),
    );
    return reply.code(201).send({ configSet: set, lab: updatedLab });
  });

  app.patch("/labs/:labId/config-sets/:setId", async (request, reply) => {
    const params = z
      .object({ labId: z.string().min(1), setId: z.string().min(1) })
      .parse(request.params);
    const body = z.object({ name: z.string().min(1) }).parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) return reply.code(404).send({ message: "Lab not found" });

    const existing = lab.document.startupConfigSets.find(
      (s) => s.id === params.setId,
    );
    if (!existing)
      return reply.code(404).send({ message: "Config set not found" });

    const updated = { ...existing, name: body.name };
    const updatedLab = await updateLabDocument(
      params.labId,
      upsertStartupConfigSet(lab.document, updated),
    );
    return reply.send({ configSet: updated, lab: updatedLab });
  });

  app.delete("/labs/:labId/config-sets/:setId", async (request, reply) => {
    const params = z
      .object({ labId: z.string().min(1), setId: z.string().min(1) })
      .parse(request.params);
    const lab = await getManagedLab(params.labId);
    if (!lab) return reply.code(404).send({ message: "Lab not found" });

    const updatedLab = await updateLabDocument(
      params.labId,
      deleteStartupConfigSet(lab.document, params.setId),
    );
    return reply.send({ lab: updatedLab });
  });

  app.patch("/labs/:labId/active-config-set", async (request, reply) => {
    const params = z.object({ labId: z.string().min(1) }).parse(request.params);
    const body = z
      .object({ activeConfigSetId: z.string().min(1).nullable() })
      .parse(request.body);
    const lab = await getManagedLab(params.labId);
    if (!lab) return reply.code(404).send({ message: "Lab not found" });

    if (body.activeConfigSetId !== null) {
      const exists = lab.document.startupConfigSets.some(
        (s) => s.id === body.activeConfigSetId,
      );
      if (!exists)
        return reply.code(404).send({ message: "Config set not found" });
    }

    const updatedLab = await updateLabDocument(
      params.labId,
      setActiveConfigSet(lab.document, body.activeConfigSetId),
    );
    return reply.send({ lab: updatedLab });
  });

  app.put(
    "/labs/:labId/config-sets/:setId/nodes/:nodeId",
    async (request, reply) => {
      const params = z
        .object({
          labId: z.string().min(1),
          setId: z.string().min(1),
          nodeId: z.string().min(1),
        })
        .parse(request.params);
      const body = z.object({ config: z.string() }).parse(request.body);
      const lab = await getManagedLab(params.labId);
      if (!lab) return reply.code(404).send({ message: "Lab not found" });

      const setExists = lab.document.startupConfigSets.some(
        (s) => s.id === params.setId,
      );
      if (!setExists)
        return reply.code(404).send({ message: "Config set not found" });

      const updatedLab = await updateLabDocument(
        params.labId,
        setNodeConfig(lab.document, params.setId, params.nodeId, body.config),
      );
      return reply.send({ lab: updatedLab });
    },
  );

  app.delete(
    "/labs/:labId/config-sets/:setId/nodes/:nodeId",
    async (request, reply) => {
      const params = z
        .object({
          labId: z.string().min(1),
          setId: z.string().min(1),
          nodeId: z.string().min(1),
        })
        .parse(request.params);
      const lab = await getManagedLab(params.labId);
      if (!lab) return reply.code(404).send({ message: "Lab not found" });

      const updatedLab = await updateLabDocument(
        params.labId,
        removeNodeConfig(lab.document, params.setId, params.nodeId),
      );
      return reply.send({ lab: updatedLab });
    },
  );
};
