import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const startScript = path.join(rootDir, "start.sh");

function runStart(args) {
  return spawnSync("sh", [startScript, "--dry-run", ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
}

test("start.sh defaults to localhost mode", () => {
  const result = runStart([]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NETWORKCHUM_BIND_MODE=localhost .*npm run dev/);
});

test("start.sh supports lan mode", () => {
  const result = runStart(["lan"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NETWORKCHUM_BIND_MODE=lan .*npm run dev/);
});

test("start.sh passes a data dir to dev:api", () => {
  const result = runStart([
    "localhost",
    "dev:api",
    "--data-dir",
    "/path/to/networkchum-data",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /NETWORKCHUM_BIND_MODE=localhost NETWORKCHUM_DATA_DIR=\/path\/to\/networkchum-data .*npm run dev:api/,
  );
});

test("start.sh supports sudo-api for the full stack", () => {
  const result = runStart(["lan", "--sudo-api"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /LAN URL: http:\/\/<server-ip>|LAN URL: http:\/\//,
  );
  assert.match(result.stdout, /\[dry-run\] .*sudo env PATH=.*npm run dev:api/);
  assert.match(result.stdout, /npm run dev:web/);
  assert.match(result.stdout, /npm run dev:bridge/);
});

test("start.sh supports sudo-api for dev:api", () => {
  const result = runStart(["lan", "dev:api", "--sudo-api"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[dry-run\] sudo env PATH=.* .*npm run dev:api/);
});
