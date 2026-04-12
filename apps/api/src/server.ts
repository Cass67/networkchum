import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveListenHost } from "@networkchum/shared";

import { buildApp } from "./app.js";
import { scanImages } from "./images/scanImages.js";
import { syncSocketTopology } from "./runtime/syncSocketTopology.js";
import { getImagesDir } from "./storagePaths.js";

const execFileAsync = promisify(execFile);

const app = buildApp({
  runtime: {
    runCommand: async (command, args) => {
      try {
        const result = await execFileAsync(command, args);
        return {
          ok: true,
          stdout: result.stdout,
          stderr: result.stderr,
        };
      } catch (error) {
        return {
          ok: false,
          stdout: "",
          stderr: error instanceof Error ? error.message : "Command failed",
        };
      }
    },
  },
});

app
  .listen({
    host: resolveListenHost(process.env.NETWORKCHUM_BIND_MODE),
    port: 4000,
  })
  .then(async () => {
    const socketTopology = await syncSocketTopology();
    if (socketTopology.nics > 0) {
      console.log(
        `[startup] restored socket topology for ${socketTopology.qemuNodes} running qemu node(s) across ${socketTopology.attachments} attachment(s)`,
      );
    }

    try {
      const images = await scanImages(getImagesDir());
      if (images.length > 0) {
        console.log(
          `[startup] scanned ${images.length} image(s) from ${getImagesDir()}`,
        );
      }
    } catch {
      console.log("[startup] no images directory found, skipping scan");
    }
  })
  .catch((error) => {
    app.log.error(error);
    process.exitCode = 1;
  });
