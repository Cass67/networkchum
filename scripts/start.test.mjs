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

function runStartWithFakeNpm(args, npmScript, extraEnv = {}) {
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
      ...extraEnv,
    },
  });
}

const trivialNpm = '#!/bin/sh\nif [ "$1" = "ls" ]; then exit 0; fi\nexit 0\n';

const fakePodman =
  [
    "#!/bin/sh",
    'printf "%s\\n" "$*" >> "$NC_PODMAN_LOG"',
    'if [ "$1" = "ps" ]; then',
    "  printf 'aaaa1111\\nbbbb2222\\n'",
    "fi",
    "exit 0",
  ].join("\n") + "\n";

function runStartWithFakePodman(args, podmanScript = fakePodman) {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "networkchum-podman-"));
  const podmanPath = path.join(binDir, "podman");
  const logFile = path.join(binDir, "calls.log");

  fs.writeFileSync(podmanPath, podmanScript, { mode: 0o755 });
  fs.writeFileSync(logFile, "");

  const result = spawnSync("sh", [startScript, ...args], {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      NC_PODMAN_LOG: logFile,
    },
  });

  return { result, log: fs.readFileSync(logFile, "utf8") };
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

test("start.sh doctor runs read-only diagnostics", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "networkchum-doctor-"));

  const result = spawnSync(
    "sh",
    [startScript, "doctor", "--data-dir", dataDir],
    { cwd: rootDir, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NetworkChum doctor/);
  assert.match(result.stdout, /WARNING: no VM images are bound/);
});

function makeConfigFile() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "networkchum-config-")),
    "start.conf",
  );
}

test("start.sh remembers and reuses the last mode and data dir", () => {
  const configFile = makeConfigFile();
  const env = { NETWORKCHUM_START_CONFIG: configFile };

  const first = runStartWithFakeNpm(
    ["lan", "--data-dir", "/path/to/data"],
    trivialNpm,
    env,
  );
  assert.equal(first.status, 0, first.stderr);
  assert.match(fs.readFileSync(configFile, "utf8"), /^MODE=lan$/m);
  assert.match(
    fs.readFileSync(configFile, "utf8"),
    /^DATA_DIR=\/path\/to\/data$/m,
  );

  const second = runStartWithFakeNpm([], trivialNpm, env);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Using saved last-run defaults/);
  assert.match(second.stdout, /mode=lan, data-dir=\/path\/to\/data/);
});

test("start.sh explicit args override the saved defaults", () => {
  const configFile = makeConfigFile();
  fs.writeFileSync(configFile, "MODE=lan\nDATA_DIR=/saved\n");
  const env = { NETWORKCHUM_START_CONFIG: configFile };

  const result = runStartWithFakeNpm(
    ["localhost", "--data-dir", "/override"],
    trivialNpm,
    env,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Using saved last-run defaults/);
  assert.match(fs.readFileSync(configFile, "utf8"), /^MODE=localhost$/m);
  assert.match(fs.readFileSync(configFile, "utf8"), /^DATA_DIR=\/override$/m);
});

test("start.sh forget clears the saved defaults", () => {
  const configFile = makeConfigFile();
  fs.writeFileSync(configFile, "MODE=lan\nDATA_DIR=/saved\n");

  const result = spawnSync("sh", [startScript, "forget"], {
    cwd: rootDir,
    encoding: "utf8",
    env: { ...process.env, NETWORKCHUM_START_CONFIG: configFile },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Cleared saved last-run defaults/);
  assert.equal(fs.existsSync(configFile), false);
});

test("start.sh serve dry-run prints the production command", () => {
  const result = runStart(["serve"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /exec concurrently -- -k -n api,web/);
  assert.match(result.stdout, /apps\/api\/dist\/server\.js/);
  assert.match(result.stdout, /scripts\/serve-web\.mjs/);
});

test("start.sh install-service dry-run prints the unit", () => {
  const result = runStart(["install-service"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\/etc\/systemd\/system\/networkchum\.service/);
  assert.match(result.stdout, /^ExecStart=.*start\.sh serve$/m);
  assert.match(
    result.stdout,
    /^AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW$/m,
  );
  assert.match(
    result.stdout,
    /sudo systemctl enable --now networkchum\.service/,
  );
});

test("start.sh uninstall-service dry-run prints the removal", () => {
  const result = runStart(["uninstall-service"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /sudo systemctl disable --now networkchum\.service/,
  );
  assert.match(
    result.stdout,
    /sudo rm -f \/etc\/systemd\/system\/networkchum\.service/,
  );
});

test("start.sh clean dry-run lists exited containers without removing them", () => {
  const { result, log } = runStartWithFakePodman(["--dry-run", "clean"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /aaaa1111/);
  assert.match(result.stdout, /bbbb2222/);
  assert.match(result.stdout, /\[dry-run\] would run: podman rm -f/);
  assert.doesNotMatch(log, /^rm /m);
});

test("start.sh clean removes exited containers", () => {
  const { result, log } = runStartWithFakePodman(["clean"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Removed 2 container\(s\)/);
  assert.match(log, /^rm -f aaaa1111$/m);
  assert.match(log, /^rm -f bbbb2222$/m);
});

test("start.sh clean reports when there is nothing to remove", () => {
  const emptyPodman =
    ["#!/bin/sh", 'printf "%s\\n" "$*" >> "$NC_PODMAN_LOG"', "exit 0"].join(
      "\n",
    ) + "\n";
  const { result, log } = runStartWithFakePodman(["clean"], emptyPodman);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No exited NetworkChum containers to remove/);
  assert.doesNotMatch(log, /^rm /m);
});

test("serve generates an API token file once and reuses it", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "networkchum-token-"));
  try {
    const first = runStartWithFakeNpm(
      ["serve", "--data-dir", dataDir],
      trivialNpm,
    );
    assert.equal(first.status, 0, first.stderr);
    const tokenFile = path.join(dataDir, "api-token");
    assert.ok(fs.existsSync(tokenFile), "token file created");
    const stat = fs.statSync(tokenFile);
    assert.equal(stat.mode & 0o777, 0o600, "token file is mode 600");
    const token = fs.readFileSync(tokenFile, "utf8");
    assert.ok(token.length >= 32, "token is a 32-char hex string");

    const second = runStartWithFakeNpm(
      ["serve", "--data-dir", dataDir],
      trivialNpm,
    );
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(tokenFile, "utf8"), token, "token reused");
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("serve respects a pre-set NETWORKCHUM_API_TOKEN", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "networkchum-token2-"));
  try {
    const result = runStartWithFakeNpm(
      ["serve", "--data-dir", dataDir],
      trivialNpm,
      {
        NETWORKCHUM_API_TOKEN: "preset-token",
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      !fs.existsSync(path.join(dataDir, "api-token")),
      "no token file written when env token is preset",
    );
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
