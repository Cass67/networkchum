import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { ImportCommitRequestSchema } from "@networkchum/shared";

import type { AppDependencies } from "../app.js";
import { listImages } from "../images/imageStore.js";
import { createLabFromDocument } from "../labs/labStore.js";
import { TemplateRegistry } from "../templates/templateRegistry.js";
import { buildLabDocumentFromImport } from "../importers/commitImport.js";
import {
  buildImportPreview,
  matchImportedNode,
} from "../importers/deviceMatcher.js";
import {
  createImportDraft,
  deleteImportDraft,
  getImportDraft,
  pruneImportDrafts,
} from "../importers/importDraftStore.js";
import { importedTemplateKey } from "../importers/normalize.js";
import { parseEveUnlTopology } from "../importers/eveUnlParser.js";
import { parseGns3Topology } from "../importers/gns3Parser.js";
import { readTopologyUpload } from "../importers/packageReader.js";
import type { NormalizedImportedTopology } from "../importers/types.js";

function parseTopologyPayload(
  payload: Awaited<ReturnType<typeof readTopologyUpload>>,
): NormalizedImportedTopology {
  switch (payload.format) {
    case "eve-unl":
    case "pnetlab-unl":
      return parseEveUnlTopology(payload);
    case "gns3":
    case "gns3-project":
      return parseGns3Topology(payload);
    default:
      throw new Error("Unsupported topology format");
  }
}

export const importRoutes: FastifyPluginAsync<AppDependencies> = async (
  app,
) => {
  app.post("/imports/topology/preview", async (request, reply) => {
    const file = await request.file({ limits: { fileSize: 50 * 1024 * 1024 } });
    if (!file) {
      return reply.code(400).send({ message: "Topology file is required" });
    }

    let topology: NormalizedImportedTopology;
    try {
      const payload = await readTopologyUpload({
        fileName: file.filename,
        content: await file.toBuffer(),
      });
      topology = parseTopologyPayload(payload);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : "Invalid import file",
      });
    }

    await pruneImportDrafts();
    const draft = await createImportDraft(topology);
    const registry = new TemplateRegistry();
    const preview = buildImportPreview({
      draftId: draft.id,
      topology,
      templates: registry.list(),
      images: await listImages(),
    });
    return reply.send({ preview });
  });

  app.post("/imports/topology/:draftId/commit", async (request, reply) => {
    const params = z
      .object({ draftId: z.string().min(1) })
      .parse(request.params);
    const body = ImportCommitRequestSchema.parse(request.body);
    const excludedNodeIds = z
      .object({
        excludedNodeIds: z.array(z.string().min(1)).default(() => []),
      })
      .passthrough()
      .parse(request.body).excludedNodeIds;
    const draft = await getImportDraft(params.draftId);
    if (!draft) {
      return reply.code(404).send({ message: "Import draft not found" });
    }

    const registry = new TemplateRegistry();
    const templates = registry.list();
    const images = await listImages();
    const bodyMappings = new Map(
      body.mappings.map((mapping) => [mapping.templateKey, mapping]),
    );
    const excludedNodeIdSet = new Set(excludedNodeIds);
    const resolvedMappings = new Map<
      string,
      {
        template: NonNullable<ReturnType<TemplateRegistry["get"]>>;
        imageId?: string | null;
      }
    >();

    for (const node of draft.topology.nodes) {
      if (excludedNodeIdSet.has(node.foreignId)) continue;
      const key = importedTemplateKey(node);
      if (resolvedMappings.has(key)) continue;

      const requested = bodyMappings.get(key);
      if (requested) {
        const template = registry.get(requested.templateId);
        if (!template) {
          return reply
            .code(400)
            .send({ message: `Template ${requested.templateId} not found` });
        }
        if (requested.imageId) {
          const image = images.find(
            (entry) =>
              entry.id === requested.imageId && entry.catalogState === "active",
          );
          if (!image) {
            return reply
              .code(400)
              .send({ message: `Image ${requested.imageId} not found` });
          }
        }
        resolvedMappings.set(key, {
          template,
          imageId: requested.imageId ?? null,
        });
        continue;
      }

      const match = matchImportedNode({ node, templates, images });
      if (!match.template) {
        return reply.code(400).send({
          message: `Missing substitute template for ${node.name}`,
        });
      }
      resolvedMappings.set(key, {
        template: match.template,
        imageId: match.image?.id ?? null,
      });
    }

    const labId = `lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const labName = body.name?.trim() || draft.topology.name;
    const document = buildLabDocumentFromImport({
      labId,
      labName,
      topology: draft.topology,
      resolvedMappings,
      excludedNodeIds,
    });
    const lab = await createLabFromDocument(labName, document);
    await deleteImportDraft(params.draftId);
    return reply.code(201).send({ lab });
  });
};
