#!/usr/bin/env node
// NetworkChum preflight diagnostics: prints the resolved config and host facts
// that explain what the device catalog will actually contain. Read-only; always
// exits 0 so it is safe to run at any time. Invoke via `./start.sh doctor`.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Exit quietly when stdout is closed early (e.g. `./start.sh doctor | head`).
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") {
    process.exit(0);
  }
  throw error;
});

const bindMode = process.env.NETWORKCHUM_BIND_MODE ?? "localhost";
const dataDir =
  process.env.NETWORKCHUM_DATA_DIR ?? path.join(repoRoot, "apps/api/data");
const imagesDir = path.join(dataDir, "images");
const imagesFile = path.join(dataDir, "images.json");

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "?";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function which(bin) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not executable here; keep looking
    }
  }
  return null;
}

function describeDir(dir) {
  try {
    return fs.statSync(dir).isDirectory() ? "[ok]" : "[not a directory]";
  } catch {
    return "[missing]";
  }
}

function readImagesIndex() {
  try {
    const parsed = JSON.parse(fs.readFileSync(imagesFile, "utf8"));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function listDiskImages() {
  try {
    return fs.readdirSync(imagesDir).filter((name) => name.endsWith(".qcow2"));
  } catch {
    return [];
  }
}

function containerStore(engineName) {
  const format =
    engineName === "podman"
      ? "{{.Store.GraphRoot}}|{{.Host.Security.Rootless}}"
      : "{{.DockerRootDir}}|";
  const result = spawnSync(engineName, ["info", "--format", format], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (result.status !== 0 || !result.stdout) {
    return null;
  }
  const [graphRoot, rootless] = result.stdout.trim().split("|");
  if (!graphRoot) {
    return null;
  }
  const mode =
    rootless === "true" ? "rootless" : rootless === "false" ? "rootful" : "";
  return { graphRoot, mode };
}

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const settle = (listening) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(400);
    socket.once("connect", () => settle("listening"));
    socket.once("timeout", () => settle("free"));
    socket.once("error", () => settle("free"));
  });
}

function imageState(image) {
  if (image.catalogState === "removed") {
    return "removed";
  }
  return image.templateId ? "bound" : "unbound";
}

function printImages(index, diskImages) {
  const hint =
    "set NETWORKCHUM_DATA_DIR (or pass --data-dir) to the data dir that holds your VM images";

  if (!index) {
    console.log(`  images.json  not found (${imagesFile})`);
    if (diskImages.length > 0) {
      console.log(
        `  found        ${diskImages.length} .qcow2 file(s) on disk; the API registers them at startup`,
      );
    } else {
      console.log(`  hint         ${hint}`);
    }
    return 0;
  }

  const bound = index.filter(
    (i) => i.templateId && i.catalogState !== "removed",
  );
  const removed = index.filter((i) => i.catalogState === "removed");
  console.log(
    `  images.json  ${index.length} record(s): ${bound.length} bound, ` +
      `${index.length - bound.length - removed.length} unbound, ${removed.length} removed`,
  );

  for (const image of index) {
    const target = image.templateId ?? "unbound";
    const fileOk = fs.existsSync(image.path) ? "file ok" : "file MISSING";
    const size = formatBytes(image.sizeBytes).padStart(8);
    console.log(
      `    ${image.name.padEnd(28)} ${size}  -> ${target} [${imageState(image)}] ${fileOk}`,
    );
  }

  if (bound.length === 0) {
    console.log(`  hint         no images are bound to a template; ${hint}`);
  }
  return bound.length;
}

function describeWritable(dir) {
  const probe = path.join(dir, ".doctor-write-test");
  try {
    fs.writeFileSync(probe, "x");
    fs.unlinkSync(probe);
    return "writable";
  } catch (error) {
    return `NOT WRITABLE (${error.code ?? error.message ?? error})`;
  }
}

console.log("NetworkChum doctor");
console.log("==================");
console.log();
console.log("environment");
console.log(`  bind mode    ${bindMode}`);
console.log(`  repo         ${repoRoot}`);
console.log(`  data dir     ${dataDir}  ${describeDir(dataDir)}`);
if (fs.existsSync(dataDir)) {
  console.log(`  data dir access ${describeWritable(dataDir)}`);
}
console.log(`  images dir   ${imagesDir}  ${describeDir(imagesDir)}`);
console.log();
console.log("images");

const index = readImagesIndex();
const diskImages = listDiskImages();
const boundCount = printImages(index, diskImages);
console.log();

const qemu = which("qemu-system-x86_64");
const qemuFallback =
  qemu ??
  which("qemu-kvm") ??
  (fs.existsSync("/usr/libexec/qemu-kvm") ? "/usr/libexec/qemu-kvm" : null);
const hasKvm = fs.existsSync("/dev/kvm");
const podman = which("podman");
const docker = which("docker");
const engineName = podman ? "podman" : docker ? "docker" : null;

console.log("host tools");
console.log(
  `  qemu-system-x86_64   ${qemu ?? (qemuFallback ? `not found (found ${qemuFallback})` : "not found")}`,
);
console.log(`  /dev/kvm             ${hasKvm ? "yes" : "no"}`);
console.log();

console.log("containers");
if (!engineName) {
  console.log(
    "  engine       not found (podman or docker is required for container nodes)",
  );
} else {
  const enginePath = engineName === "podman" ? podman : docker;
  const store = containerStore(engineName);
  console.log(`  engine       ${engineName} (${enginePath})`);
  if (store) {
    console.log(
      `  store        ${store.graphRoot}${store.mode ? ` (${store.mode})` : ""}`,
    );
  } else {
    console.log("  store        unknown (engine did not respond to 'info')");
  }
  console.log(
    "  hint         containers are per-user: an API run with --sudo-api or",
  );
  console.log(
    "               systemd uses that user's store (root -> /var/lib/containers/storage)",
  );
  console.log(
    "               remove exited NetworkChum containers: ./start.sh clean",
  );
}
console.log();

console.log("api token");
const tokenFile = path.join(dataDir, "api-token");
const storedToken = fs.existsSync(tokenFile)
  ? fs.readFileSync(tokenFile, "utf8").trim()
  : "";
if (storedToken) {
  console.log(`  file         ${tokenFile}`);
  console.log(`  token        ${storedToken}`);
} else {
  console.log(`  none         ${tokenFile} does not exist or is empty`);
  console.log(
    "  hint         run ./start.sh serve to generate one, or pass --data-dir if the token lives elsewhere",
  );
}
console.log();

const ports = await Promise.all([4000, 5173, 4010].map(checkPort));
console.log("ports");
console.log(`  4000 (api)      ${ports[0]}`);
console.log(`  5173 (web)      ${ports[1]}`);
console.log(`  4010 (bridge)   ${ports[2]}`);
console.log();

if (index && boundCount > 0) {
  console.log(`OK: ${boundCount} image(s) bound to templates`);
} else {
  console.log(
    "WARNING: no VM images are bound to templates; the device catalog will only show container and cloud templates",
  );
}
