#!/usr/bin/env node
// Dependency-free static file server for the production web build (apps/web/dist).
// Used by `./start.sh serve` and the systemd unit. Mirrors the API bind rule in
// packages/shared/src/networkAccess.ts: lan -> 0.0.0.0, otherwise 127.0.0.1.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const WEB_ROOT = path.join(repoRoot, "apps/web/dist");
export const WEB_PORT = Number(process.env.NETWORKCHUM_WEB_PORT ?? 5173);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function contentTypeFor(filePath) {
  return (
    CONTENT_TYPES[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}

function resolveFile(rootDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed percent-encoding
  }
  const candidate = path.normalize(path.join(rootDir, decoded));
  if (candidate !== rootDir && !candidate.startsWith(rootDir + path.sep)) {
    return null;
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return candidate;
  }
  // SPA fallback: unknown paths render the app shell.
  return path.join(rootDir, "index.html");
}

export function createWebServer({ rootDir = WEB_ROOT } = {}) {
  return http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    const filePath = resolveFile(rootDir, pathname);

    if (!filePath) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "content-type": contentTypeFor(filePath) });
      res.end(data);
    });
  });
}

function resolveListenHost(value) {
  return value === "lan" ? "0.0.0.0" : "127.0.0.1";
}

const isMainModule =
  import.meta.main === true ||
  (process.argv[1] !== undefined &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));

if (isMainModule) {
  if (!fs.existsSync(path.join(WEB_ROOT, "index.html"))) {
    console.error(
      `error: no production web build at ${WEB_ROOT}; run: npm run build`,
    );
    process.exit(1);
  }
  const host = resolveListenHost(process.env.NETWORKCHUM_BIND_MODE);
  createWebServer({ rootDir: WEB_ROOT }).listen(WEB_PORT, host, () => {
    console.log(
      `NetworkChum web listening on http://${host}:${WEB_PORT} (serving ${WEB_ROOT})`,
    );
  });
}
