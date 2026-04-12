import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { getDataDir, getDataFile } from "../storagePaths.js";

export type TemplateDefaultsOverride = Partial<{
  ramMb: number;
  vcpu: number;
  interfaceCount: number;
}>;

type TemplateOverrideMap = Record<string, TemplateDefaultsOverride>;

function templateOverridesFile(): string {
  return getDataFile("template-overrides.json");
}

export function listTemplateOverrides(): TemplateOverrideMap {
  const file = templateOverridesFile();
  if (!existsSync(file)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(file, "utf8")) as TemplateOverrideMap;
  } catch {
    return {};
  }
}

export function saveTemplateOverrides(overrides: TemplateOverrideMap): void {
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(templateOverridesFile(), JSON.stringify(overrides, null, 2));
}
