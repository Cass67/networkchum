import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  AiProviderKindSchema,
  AiLabCommitRequestSchema,
  AiProviderSettingsSchema,
} from "@networkchum/shared";

import type { AppDependencies } from "../app.js";
import { buildLabDocumentFromSpec } from "../ai/buildLabDocumentFromSpec.js";
import { generateLabSpec } from "../ai/generateLabSpec.js";
import { probeModels } from "../ai/llmClient.js";
import {
  loadAiProviderSettings,
  saveAiProviderSettings,
  toProviderSettingsView,
} from "../ai/providerSettingsStore.js";
import { listImages } from "../images/imageStore.js";
import { createLabFromDocument } from "../labs/labStore.js";
import { TemplateRegistry } from "../templates/templateRegistry.js";

function parseBody<Schema extends z.ZodTypeAny>(
  schema: Schema,
  body: unknown,
): { ok: true; data: z.infer<Schema> } | { ok: false; message: string } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return {
    ok: false,
    message: result.error.issues[0]?.message ?? "Invalid request body",
  };
}

export const aiRoutes: FastifyPluginAsync<AppDependencies> = async (
  app,
  options,
) => {
  const fetcher = options.runtime?.fetcher ?? fetch;

  app.get("/ai/provider", async () => {
    const settings = loadAiProviderSettings();
    return { provider: settings ? toProviderSettingsView(settings) : null };
  });

  app.put("/ai/provider", async (request, reply) => {
    const body = parseBody(AiProviderSettingsSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send({ message: body.message });
    }
    const settings = body.data;
    const existing = loadAiProviderSettings();
    if (!settings.apiKey) {
      // Null key on save means "keep the previously stored key" so the UI can
      // edit the other fields without re-entering the secret.
      if (!existing?.apiKey) {
        return reply.code(400).send({
          message:
            "An API key is required the first time you configure a provider",
        });
      }
      settings.apiKey = existing.apiKey;
    }
    saveAiProviderSettings(settings);
    return { provider: toProviderSettingsView(settings) };
  });

  app.post("/ai/provider/probe", async (request, reply) => {
    const body = parseBody(
      z.object({
        provider: AiProviderKindSchema,
        baseUrl: z.string().trim().min(1),
        // Omitted = use the stored key, so the dialog can detect models
        // without re-entering the secret.
        apiKey: z.string().min(1).optional(),
      }),
      request.body,
    );
    if (!body.ok) {
      return reply.code(400).send({ message: body.message });
    }
    const apiKey = body.data.apiKey ?? loadAiProviderSettings()?.apiKey ?? null;

    try {
      const models = await probeModels({
        provider: body.data.provider,
        baseUrl: body.data.baseUrl,
        apiKey,
        fetcher,
      });
      return { models };
    } catch (error) {
      return reply.code(502).send({
        message:
          error instanceof Error ? error.message : "Model detection failed",
      });
    }
  });

  app.post("/ai/labs/preview", async (request, reply) => {
    const body = parseBody(
      z.object({ prompt: z.string().trim().min(1) }),
      request.body,
    );
    if (!body.ok) {
      return reply.code(400).send({ message: body.message });
    }
    const settings = loadAiProviderSettings();
    if (!settings) {
      return reply.code(400).send({
        message:
          "LLM provider is not configured yet. Save a provider endpoint, model, and API key first.",
      });
    }
    if (settings.provider === "anthropic" && !settings.apiKey) {
      return reply.code(400).send({
        message: "The Anthropic provider requires an API key",
      });
    }

    const registry = new TemplateRegistry();
    const templates = registry.list();
    const images = await listImages();

    try {
      const { spec } = await generateLabSpec({
        prompt: body.data.prompt,
        settings,
        templates,
        images,
        fetcher,
      });
      const preview = buildLabDocumentFromSpec({
        labId: "lab-ai-preview",
        spec,
        templates,
        images,
      });
      return { preview };
    } catch (error) {
      return reply.code(502).send({
        message:
          error instanceof Error
            ? error.message
            : "Failed to generate a lab spec from the LLM provider",
      });
    }
  });

  app.post("/ai/labs/commit", async (request, reply) => {
    const body = parseBody(AiLabCommitRequestSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send({ message: body.message });
    }
    const registry = new TemplateRegistry();
    const templates = registry.list();
    const images = await listImages();

    const labId = `lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const preview = buildLabDocumentFromSpec({
      labId,
      spec: body.data.spec,
      templates,
      images,
    });
    if (!preview.document) {
      const firstError = preview.issues.find(
        (issue) => issue.severity === "error",
      );
      return reply.code(400).send({
        message: firstError
          ? `Cannot commit: ${firstError.message}`
          : "Cannot commit: one or more nodes have no matching template",
      });
    }

    const lab = await createLabFromDocument(body.data.name, preview.document);
    return reply.code(201).send({ lab });
  });
};
