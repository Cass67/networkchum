import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

test("web dev script does not pin Vite to localhost", () => {
  const webPackage = readJson(path.join(rootDir, "apps/web/package.json"));

  assert.equal(typeof webPackage.scripts?.dev, "string");
  assert.doesNotMatch(webPackage.scripts.dev, /--host\s+127\.0\.0\.1/);
});

test("root dev:reset script does not depend on a localhost-only Vite command", () => {
  const rootPackage = readJson(path.join(rootDir, "package.json"));

  assert.equal(typeof rootPackage.scripts?.["dev:reset"], "string");
  assert.doesNotMatch(
    rootPackage.scripts["dev:reset"],
    /vite --host 127\.0\.0\.1 --port 5173 --strictPort/,
  );
});
