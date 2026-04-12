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

function assertLinuxUsesOfficialNode(output) {
  assert.match(
    output,
    /curl -fsSL https:\/\/nodejs\.org\/download\/release\/latest-v24\.x\/SHASUMS256\.txt -o/,
  );
  assert.match(output, /sudo ln -sf .*\/bin\/node \/usr\/local\/bin\/node/);
  assert.match(output, /sudo ln -sf .*\/bin\/npm \/usr\/local\/bin\/npm/);
  assert.match(output, /sudo ln -sf .*\/bin\/npx \/usr\/local\/bin\/npx/);
  assert.doesNotMatch(output, /sudo (apt|dnf|pacman) .* \bnodejs\b/);
  assert.doesNotMatch(output, /sudo (apt|dnf|pacman) .* \bnpm\b/);
}

test("linux podman mode installs podman with docker compatibility", () => {
  const result = runInstaller([
    "--os=linux",
    "--package-manager=dnf",
    "--container-runtime=podman",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assertLinuxUsesOfficialNode(result.stdout);
  assert.match(
    result.stdout,
    /sudo dnf install -y .*git.*curl.*ca-certificates.*xz/,
  );
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
  assertLinuxUsesOfficialNode(result.stdout);
  assert.match(
    result.stdout,
    /sudo apt install -y .*git.*curl.*ca-certificates.*xz-utils/,
  );
  assert.doesNotMatch(result.stdout, /\bbridge-utils\b/);
  assert.match(result.stdout, /sudo apt install -y .*docker\.io/);
  assert.match(result.stdout, /sudo systemctl enable --now docker/);
  assert.match(result.stdout, /sudo usermod -aG docker/);
});

test("linux firewalld detection leaves ports unchanged in non-interactive mode", () => {
  const result = runInstaller([
    "--os=linux",
    "--package-manager=dnf",
    "--container-runtime=podman",
    "--firewall=firewalld",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Firewall: firewalld/);
  assert.match(result.stdout, /LAN firewall rules: unchanged/);
  assert.match(
    result.stdout,
    /rerun with --open-firewall or open 4000\/tcp and 5173\/tcp manually/,
  );
  assert.doesNotMatch(
    result.stdout,
    /sudo firewall-cmd --permanent --add-port=4000\/tcp/,
  );
});

test("linux firewalld mode can plan opening NetworkChum LAN ports", () => {
  const result = runInstaller([
    "--os=linux",
    "--package-manager=dnf",
    "--container-runtime=podman",
    "--firewall=firewalld",
    "--open-firewall",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /sudo firewall-cmd --permanent --add-port=4000\/tcp/,
  );
  assert.match(
    result.stdout,
    /sudo firewall-cmd --permanent --add-port=5173\/tcp/,
  );
  assert.match(result.stdout, /sudo firewall-cmd --reload/);
  assert.match(result.stdout, /LAN firewall rules: open 4000\/tcp, 5173\/tcp/);
});

test("macOS mode plans the baseline, qemu, and docker desktop installs", () => {
  const result = runInstaller(["--os=macos", "--package-manager=brew"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /brew install git node qemu socat/);
  assert.match(result.stdout, /brew install --cask docker/);
  assert.match(result.stdout, /npm install/);
});
