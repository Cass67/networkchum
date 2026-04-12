import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const installer = path.join(rootDir, "install.sh");

function runInstaller(args) {
  return spawnSync("sh", [installer, "--dry-run", "--yes", ...args], {
    cwd: rootDir,
    encoding: "utf8",
  });
}

test("linux podman mode installs podman with docker compatibility", () => {
  const result = runInstaller([
    "--os=linux",
    "--package-manager=dnf",
    "--container-runtime=podman",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /sudo dnf install -y .*qemu-kvm.*qemu-img.*iproute/,
  );
  assert.doesNotMatch(result.stdout, /\bqemu-system-x86\b/);
  assert.doesNotMatch(result.stdout, /\bbridge-utils\b/);
  assert.match(result.stdout, /sudo dnf install -y .*podman.*podman-docker/);
  assert.doesNotMatch(result.stdout, /\bmoby-engine\b/);
});

test("linux docker mode installs docker engine packages and service setup", () => {
  const result = runInstaller([
    "--os=linux",
    "--package-manager=apt",
    "--container-runtime=docker",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /sudo apt install -y .*docker\.io/);
  assert.match(result.stdout, /sudo systemctl enable --now docker/);
  assert.match(result.stdout, /sudo usermod -aG docker/);
});

test("macOS mode plans the baseline, qemu, and docker desktop installs", () => {
  const result = runInstaller(["--os=macos", "--package-manager=brew"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /brew install git node qemu socat/);
  assert.match(result.stdout, /brew install --cask docker/);
  assert.match(result.stdout, /npm install/);
});
