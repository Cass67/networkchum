import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const unitScript = path.join(rootDir, "scripts/systemd-unit.mjs");

function runUnit(env) {
  return spawnSync("node", [unitScript], {
    cwd: rootDir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("systemd unit runs the production serve command as the given user", () => {
  const result = runUnit({
    NETWORKCHUM_UNIT_USER: "cass",
    NETWORKCHUM_ROOT: "/home/cass/networkchum",
    NETWORKCHUM_BIND_MODE: "lan",
    NETWORKCHUM_DATA_DIR: "/home/cass/networkchum-data",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^\[Unit\]$/m);
  assert.match(result.stdout, /^User=cass$/m);
  assert.match(result.stdout, /^WorkingDirectory=\/home\/cass\/networkchum$/m);
  assert.match(result.stdout, /^Environment=NETWORKCHUM_BIND_MODE=lan$/m);
  assert.match(
    result.stdout,
    /^Environment=NETWORKCHUM_DATA_DIR=\/home\/cass\/networkchum-data$/m,
  );
  assert.match(result.stdout, /^Environment=PATH=.*\/usr\/sbin.*$/m);
  assert.match(
    result.stdout,
    /^StandardOutput=append:\/home\/cass\/networkchum\/\.networkchum\/service\.log$/m,
  );
  assert.match(
    result.stdout,
    /^StandardError=append:\/home\/cass\/networkchum\/\.networkchum\/service\.log$/m,
  );
  assert.match(
    result.stdout,
    /^AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW$/m,
  );
  // Rootless podman needs the default bounding set for user namespaces.
  assert.doesNotMatch(result.stdout, /^CapabilityBoundingSet=/m);
  assert.match(
    result.stdout,
    /^ExecStart=\/home\/cass\/networkchum\/start\.sh serve$/m,
  );
  assert.match(result.stdout, /^WantedBy=multi-user\.target$/m);
});

test("systemd unit omits the data dir when unset", () => {
  const result = runUnit({
    NETWORKCHUM_UNIT_USER: "cass",
    NETWORKCHUM_ROOT: "/home/cass/networkchum",
    NETWORKCHUM_BIND_MODE: "localhost",
    NETWORKCHUM_DATA_DIR: "",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /NETWORKCHUM_DATA_DIR/);
});

test("systemd unit can use the ip setcap fallback instead of ambient caps", () => {
  const result = runUnit({
    NETWORKCHUM_UNIT_USER: "cass",
    NETWORKCHUM_ROOT: "/home/cass/networkchum",
    NETWORKCHUM_BIND_MODE: "lan",
    NETWORKCHUM_TAP_MODE: "ip-capability",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /AmbientCapabilities/);
  assert.match(result.stdout, /^ExecStart=.*start\.sh serve$/m);
});

test("user-scope unit omits User= and installs into default.target", () => {
  const result = runUnit({
    NETWORKCHUM_UNIT_USER: "cass",
    NETWORKCHUM_ROOT: "/home/cass/networkchum",
    NETWORKCHUM_BIND_MODE: "lan",
    NETWORKCHUM_DATA_DIR: "/home/cass/networkchum-data",
    NETWORKCHUM_SERVICE_SCOPE: "user",
    NETWORKCHUM_TAP_MODE: "ip-capability",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /^User=/m);
  assert.doesNotMatch(result.stdout, /^AmbientCapabilities=/m);
  assert.doesNotMatch(result.stdout, /network-online/);
  assert.match(result.stdout, /^WantedBy=default\.target$/m);
  assert.match(result.stdout, /^ExecStart=.*start\.sh serve$/m);
});

test("ip-sudo tap mode enables sudo for ip in the unit", () => {
  const result = runUnit({
    NETWORKCHUM_UNIT_USER: "cass",
    NETWORKCHUM_ROOT: "/home/cass/networkchum",
    NETWORKCHUM_BIND_MODE: "lan",
    NETWORKCHUM_SERVICE_SCOPE: "user",
    NETWORKCHUM_TAP_MODE: "ip-sudo",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Environment=NETWORKCHUM_IP_SUDO=1$/m);
  assert.doesNotMatch(result.stdout, /AmbientCapabilities/);
});

test("systemd unit requires a user and a root", () => {
  const missingUser = runUnit({
    NETWORKCHUM_UNIT_USER: "",
    NETWORKCHUM_ROOT: "/home/cass/networkchum",
  });
  assert.equal(missingUser.status, 1);
  assert.match(missingUser.stderr, /NETWORKCHUM_UNIT_USER/);

  const missingRoot = runUnit({
    NETWORKCHUM_UNIT_USER: "cass",
    NETWORKCHUM_ROOT: "",
  });
  assert.equal(missingRoot.status, 1);
  assert.match(missingRoot.stderr, /NETWORKCHUM_ROOT/);
});
