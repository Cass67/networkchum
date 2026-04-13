import type { FastifyPluginAsync } from "fastify";

import { getCloudManagementCapability } from "../runtime/hostCapabilities.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    ok: true,
    capabilities: {
      cloudManagement: getCloudManagementCapability(),
    },
  }));
};
