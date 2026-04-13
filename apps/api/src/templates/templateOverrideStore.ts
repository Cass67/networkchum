import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { DeviceRoleIconSchema, type Template } from "@networkchum/shared";

import { getDataDir, getDataFile } from "../storagePaths.js";

export type TemplateDefaultsOverride = Partial<{
  ramMb: number;
  vcpu: number;
  interfaceCount: number;
  deviceRoleIcon: Template["deviceRoleIcon"];
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
    const raw = JSON.parse(readFileSync(file, "utf8")) as TemplateOverrideMap;
    return sanitizeOverrides(raw);
  } catch {
    return {};
  }
}

function sanitizeOverrides(
  overrides: TemplateOverrideMap,
): TemplateOverrideMap {
  const sanitized: TemplateOverrideMap = {};

  for (const [templateId, override] of Object.entries(overrides)) {
    if (!override || typeof override !== "object") {
      continue;
    }

    const nextOverride: TemplateDefaultsOverride = { ...override };
    if (
      nextOverride.deviceRoleIcon !== undefined &&
      !DeviceRoleIconSchema.safeParse(nextOverride.deviceRoleIcon).success
    ) {
      delete nextOverride.deviceRoleIcon;
    }

    sanitized[templateId] = nextOverride;
  }

  return sanitized;
}

export function saveTemplateOverrides(overrides: TemplateOverrideMap): void {
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(templateOverridesFile(), JSON.stringify(overrides, null, 2));
}
