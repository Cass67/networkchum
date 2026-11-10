#!/usr/bin/env node
// Bump every workspace package version and internal dependency pin without
// resolving against the npm registry: the @networkchum/* packages are private
// and never published, which makes `npm version` fail with E404.
// Usage: scripts/version-bump.mjs <x.y.z>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("usage: scripts/version-bump.mjs <x.y.z>");
  process.exit(1);
}

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const rootManifestPath = path.join(rootDir, "package.json");
const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8"));

const workspaceDirs = (rootManifest.workspaces ?? []).flatMap((pattern) => {
  const base = pattern.replace(/\/\*$/, "");
  return readdirSync(path.join(rootDir, base), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(base, entry.name));
});

const manifests = [
  "package.json",
  ...workspaceDirs.map((dir) => path.join(dir, "package.json")),
].map((relative) => ({
  relative,
  json: JSON.parse(readFileSync(path.join(rootDir, relative), "utf8")),
}));

const internalNames = new Set(
  manifests.map(({ json }) => json.name).filter(Boolean),
);

for (const { relative, json } of manifests) {
  json.version = version;
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const name of Object.keys(json[field] ?? {})) {
      if (internalNames.has(name)) {
        json[field][name] = version;
      }
    }
  }
  writeFileSync(
    path.join(rootDir, relative),
    `${JSON.stringify(json, null, 2)}\n`,
  );
}

const lockPath = path.join(rootDir, "package-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
lock.version = version;
for (const { relative, json } of manifests) {
  const lockKey =
    relative === "package.json" ? "" : relative.replace(/\/package\.json$/, "");
  const entry = lock.packages[lockKey];
  if (!entry) {
    continue;
  }
  entry.version = version;
  for (const [name, value] of Object.entries(json.dependencies ?? {})) {
    if (internalNames.has(name)) {
      entry.dependencies[name] = value;
    }
  }
}
writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

console.log(`bumped ${manifests.length} package manifests to ${version}`);
