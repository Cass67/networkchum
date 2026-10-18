import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createWebServer } from "./serve-web.mjs";

function makeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "networkchum-web-"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    "<!doctype html><title>app shell</title>",
  );
  fs.mkdirSync(path.join(dir, "assets"));
  fs.writeFileSync(path.join(dir, "assets", "app.js"), "console.log('hi');");
  return dir;
}

async function withServer(rootDir, run) {
  const server = createWebServer({ rootDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: rawPath },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("serves index.html at the root", async () => {
  const rootDir = makeRoot();
  const response = await withServer(rootDir, (port) =>
    fetch(`http://127.0.0.1:${port}/`),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /app shell/);
});

test("serves assets with the right content type", async () => {
  const rootDir = makeRoot();
  const response = await withServer(rootDir, (port) =>
    fetch(`http://127.0.0.1:${port}/assets/app.js`),
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/javascript/);
  assert.match(await response.text(), /console\.log/);
});

test("falls back to index.html for unknown SPA routes", async () => {
  const rootDir = makeRoot();
  const response = await withServer(rootDir, (port) =>
    fetch(`http://127.0.0.1:${port}/labs/123`),
  );

  assert.equal(response.status, 200);
  assert.match(await response.text(), /app shell/);
});

test("rejects path traversal outside the web root", async () => {
  const rootDir = makeRoot();
  const response = await withServer(rootDir, (port) =>
    // %2f is not a segment boundary to the URL parser, so the traversal only
    // appears after decodeURIComponent — which the server must still block.
    rawGet(port, "/%2e%2e%2f%2e%2e%2fetc%2fpasswd"),
  );

  assert.equal(response.status, 403);
});

test("does not crash on malformed percent-encoding", async () => {
  const rootDir = makeRoot();
  const response = await withServer(rootDir, (port) => rawGet(port, "/%zz"));

  assert.equal(response.status, 403);
});
