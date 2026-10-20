import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";

import { catalogRoutes } from "./routes/catalog.js";
import { consoleRoutes } from "./routes/console.js";
import { containerRoutes } from "./routes/containers.js";
import { healthRoutes } from "./routes/health.js";
import { imageRoutes } from "./routes/images.js";
import { importRoutes } from "./routes/imports.js";
import { labRoutes } from "./routes/labs.js";
import { templateRoutes } from "./routes/templates.js";

export type AppDependencies = {
  runtime?: {
    runCommand?: (
      command: string,
      args: string[],
    ) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
    hasBinary?: (command: string) => Promise<boolean>;
    fetcher?: typeof fetch;
    isBridgeInterface?: (interfaceName: string) => Promise<boolean>;
    listHostInterfaces?: () => Promise<string[]>;
  };
};

export const API_TOKEN_HEADER = "x-networkchum-token";

// Endpoints reachable without the API token. Keep this list minimal: it exists
// so liveness probes and browser CORS preflights work, nothing else.
const OPEN_ROUTES = new Set(["/health"]);

function requestProvidesToken(request: FastifyRequest, token: string) {
  const header = request.headers[API_TOKEN_HEADER];
  const authorization = request.headers.authorization;
  const provided = Array.isArray(header)
    ? header[0]
    : (header ??
      (authorization ? authorization.replace(/^Bearer\s+/i, "") : ""));
  if (typeof provided !== "string" || provided.length !== token.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(provided), Buffer.from(token));
}

export function buildApp(dependencies: AppDependencies = {}) {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 * 1024 }); // 10 GB

  const apiToken = (process.env.NETWORKCHUM_API_TOKEN ?? "").trim();
  if (apiToken) {
    app.addHook("onRequest", async (request, reply) => {
      const url = request.url.split("?")[0]!;
      if (OPEN_ROUTES.has(url) || request.method === "OPTIONS") {
        return;
      }
      if (!requestProvidesToken(request, apiToken)) {
        reply.code(401).send({ message: "Unauthorized: API token required" });
        return reply;
      }
    });
  }

  void app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Requested-With", API_TOKEN_HEADER],
  });
  void app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024 * 1024 },
  }); // 10 GB
  void app.register(websocket);

  app.register(healthRoutes);
  app.register(consoleRoutes);
  app.register(templateRoutes);
  app.register(imageRoutes);
  app.register(importRoutes, dependencies);
  app.register(catalogRoutes);
  app.register(containerRoutes, dependencies);
  app.register(labRoutes, dependencies);

  return app;
}
