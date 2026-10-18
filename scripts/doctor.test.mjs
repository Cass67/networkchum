import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const doctorScript = path.join(rootDir, "scripts/doctor.mjs");

function runDoctor(dataDir) {
  return spawnSync("node", [doctorScript], {
    cwd: rootDir,
    encoding: "utf8",
    env: { ...process.env, NETWORKCHUM_DATA_DIR: dataDir },
  });
}

function makeDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "networkchum-doctor-"));
}

test("doctor reports bound images from the configured data dir", () => {
  const dataDir = makeDataDir();
  const imagesDir = path.join(dataDir, "images");
  fs.mkdirSync(imagesDir);
  const imagePath = path.join(imagesDir, "csr-17-03_virtioa.qcow2");
  fs.writeFileSync(imagePath, "");
  fs.writeFileSync(
    path.join(dataDir, "images.json"),
    JSON.stringify([
      {
        id: "img-csr-17-03-virtioa-qcow2",
        name: "csr-17-03_virtioa.qcow2",
        path: imagePath,
        format: "qcow2",
        sizeBytes: 1458044928,
        updatedAt: "2026-04-12T17:51:24.141Z",
        templateId: "cisco-asr",
        suggestedTemplateId: null,
        source: "scan",
        catalogState: "active",
      },
    ]),
  );

  const result = runDoctor(dataDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NetworkChum doctor/);
  assert.match(
    result.stdout,
    new RegExp(dataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(
    result.stdout,
    /csr-17-03_virtioa\.qcow2.*-> cisco-asr \[bound\] file ok/,
  );
  assert.match(result.stdout, /OK: 1 image\(s\) bound to templates/);
  assert.doesNotMatch(result.stdout, /WARNING/);
});

test("doctor warns when no images are bound", () => {
  const dataDir = makeDataDir();

  const result = runDoctor(dataDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /images\.json {2}not found/);
  assert.match(result.stdout, /WARNING: no VM images are bound/);
  assert.match(result.stdout, /NETWORKCHUM_DATA_DIR/);
});

test("doctor reports the container engine section", () => {
  const result = runDoctor(makeDataDir());

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^containers$/m);
  assert.match(result.stdout, /^ {2}engine {7}/m);
});
