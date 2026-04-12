import { createConnection } from "node:net";

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { listRuntimeStates } from "../runtime/runtimeStateStore.js";

export const consoleRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/labs/:labId/nodes/:nodeId/console",
    { websocket: true },
    async (socket, request) => {
      const params = z
        .object({ labId: z.string().min(1), nodeId: z.string().min(1) })
        .parse(request.params);

      const states = await listRuntimeStates(params.labId);
      const state = states.find((s) => s.nodeId === params.nodeId);

      if (
        !state ||
        state.status !== "running" ||
        state.runtime !== "qemu" ||
        !state.consolePort
      ) {
        socket.close(4000, "Node has no active console");
        return;
      }

      const tcp = createConnection({
        host: "127.0.0.1",
        port: state.consolePort,
      });

      tcp.on("connect", () => {
        console.log(
          `[console] connected to serial port ${state.consolePort} for node ${params.nodeId}`,
        );
      });

      tcp.on("data", (chunk: Buffer) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(chunk);
        }
      });

      socket.on("message", (data: Buffer) => {
        if (!tcp.destroyed) {
          tcp.write(data);
        }
      });

      socket.on("close", () => {
        tcp.destroy();
      });

      tcp.on("close", () => {
        if (socket.readyState === socket.OPEN) {
          socket.close(1000, "Serial port closed");
        }
      });

      tcp.on("error", (err) => {
        console.error(
          `[console] TCP error for node ${params.nodeId}:`,
          err.message,
        );
        if (socket.readyState === socket.OPEN) {
          socket.close(4001, "Serial connection failed");
        }
      });
    },
  );
};
