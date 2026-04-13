import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";

import { TemplateRegistry } from "../templates/templateRegistry.js";
import { DeviceRoleIconSchema } from "../templates/deviceRoleIcon.js";

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

    const bodySchema = z.object({
      ramMb: z
        .number()
        .int()
        .min(template.configSchema.ramMb.min)
        .max(template.configSchema.ramMb.max)
        .optional(),
      vcpu: z
        .number()
        .int()
        .min(template.configSchema.vcpu.min)
        .max(template.configSchema.vcpu.max)
        .optional(),
      interfaceCount: z
        .number()
        .int()
        .min(template.configSchema.interfaceCount.min)
        .max(template.configSchema.interfaceCount.max)
        .optional(),
      deviceRoleIcon: DeviceRoleIconSchema.optional(),
    });

    const bodyResult = bodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      return reply.code(400).send({ message: bodyResult.error.message });
    }

    const defaults = {
      ramMb: bodyResult.data.ramMb ?? template.configSchema.ramMb.default,
      vcpu: bodyResult.data.vcpu ?? template.configSchema.vcpu.default,
      interfaceCount:
        bodyResult.data.interfaceCount ??
        template.configSchema.interfaceCount.default,
      deviceRoleIcon: bodyResult.data.deviceRoleIcon,
    };

    const updatedTemplate = registry.updateDefaults(
      params.templateId,
      defaults,
    );
    return reply.send({ template: updatedTemplate });
  });
};
