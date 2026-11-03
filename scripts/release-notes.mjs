#!/usr/bin/env node
// Print the changelog section for a version, for GitHub release notes.
// Usage: node scripts/release-notes.mjs 1.0.0
import { readFileSync } from "node:fs";

const version = process.argv[2];
if (!version) {
  console.error("usage: node scripts/release-notes.mjs <version>");
  process.exit(1);
}

const changelog = readFileSync(
  new URL("../CHANGELOG.md", import.meta.url),
  "utf8",
);
const lines = changelog.split("\n");
const start = lines.findIndex((line) => line.startsWith(`## ${version} `));
if (start === -1) {
  console.error(`no changelog section for ${version}`);
  process.exit(1);
}

const section = [];
for (const line of lines.slice(start + 1)) {
  if (line.startsWith("## ")) break;
  section.push(line);
}

process.stdout.write(section.join("\n").trim() + "\n");
