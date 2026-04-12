import type { FastifyPluginAsync } from "fastify";

import { getCatalog } from "../catalog/getCatalog.js";

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  app.get("/catalog", async () => ({ entries: await getCatalog() }));
};
