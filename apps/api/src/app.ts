import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";

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

export function buildApp(dependencies: AppDependencies = {}) {
  const app = Fastify({ bodyLimit: 10 * 1024 * 1024 * 1024 }); // 10 GB

  void app.register(cors, {
    origin: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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
