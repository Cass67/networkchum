import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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

function runStartWithFakeNpm(args, npmScript) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "networkchum-start-"));
  const npmPath = path.join(binDir, "npm");
  const nodePath = path.join(binDir, "node");

  fs.writeFileSync(npmPath, npmScript, { mode: 0o755 });
  fs.writeFileSync(nodePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  return spawnSync("sh", [startScript, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  assert.match(
    result.stdout,
    /\[dry-run\] .*sudo -n env PATH=.*npm run dev:api/,
  );
  assert.match(result.stdout, /npm run dev:web/);
  assert.match(result.stdout, /npm run dev:bridge/);
});

test("start.sh includes the npm directory in sudo PATH", () => {
  const result = runStart(["lan", "--sudo-api"]);

  assert.equal(result.status, 0, result.stderr);

  const npmMatch = result.stdout.match(
    /"sudo(?: -n)? env PATH=([^ ]+) .*? (\/[^ ]+\/npm) run dev:api"/,
  );
  assert.ok(npmMatch, result.stdout);

  const sudoPath = npmMatch[1];
  const npmPath = npmMatch[2];
  const npmDir = npmPath.slice(0, npmPath.lastIndexOf("/"));

  assert.match(sudoPath, new RegExp(`(^|:)${escapeRegExp(npmDir)}(:|$)`));
});

test("start.sh supports sudo-api for dev:api", () => {
  const result = runStart(["lan", "dev:api", "--sudo-api"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[dry-run\] sudo env PATH=.* .*npm run dev:api/);
});

test("start.sh uses non-interactive sudo for the full stack api child", () => {
  const result = runStart(["lan", "--sudo-api"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /\[dry-run\] .*sudo -n env PATH=.*npm run dev:api/,
  );
});

test("start.sh fails early when dependencies are stale", () => {
  const result = runStartWithFakeNpm(
    ["localhost"],
    '#!/bin/sh\nif [ "$1" = "ls" ]; then exit 1; fi\necho unexpected npm "$@" >&2\nexit 42\n',
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /dependencies are missing or stale/);
  assert.match(result.stderr, /npm install/);
});
