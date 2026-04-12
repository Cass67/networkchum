import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";

import { TemplateRegistry } from "../templates/templateRegistry.js";

export const templateRoutes: FastifyPluginAsync = async (app) => {
  const registry = new TemplateRegistry();

  app.get("/templates", async () => ({ templates: registry.list() }));

  app.patch("/templates/:templateId", async (request, reply) => {
    const params = z
      .object({ templateId: z.string().min(1) })
      .parse(request.params);
    const template = registry.get(params.templateId);

    if (!template) {
      return reply.code(404).send({ message: "Template not found" });
    }

    const body = z
      .object({
        ramMb: z
          .number()
          .int()
          .min(template.configSchema.ramMb.min)
          .max(template.configSchema.ramMb.max),
        vcpu: z
          .number()
          .int()
          .min(template.configSchema.vcpu.min)
          .max(template.configSchema.vcpu.max),
        interfaceCount: z
          .number()
          .int()
          .min(template.configSchema.interfaceCount.min)
          .max(template.configSchema.interfaceCount.max),
      })
      .parse(request.body);

    const updatedTemplate = registry.updateDefaults(params.templateId, body);
    return reply.send({ template: updatedTemplate });
  });
};
