import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import type { Template } from "@networkchum/shared";

import { getDataDir, getDataFile } from "../storagePaths.js";
import { DeviceRoleIconSchema } from "./deviceRoleIcon.js";

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

    if (!isValidOverrideNumber(nextOverride.ramMb)) {
      delete nextOverride.ramMb;
    }
    if (!isValidOverrideNumber(nextOverride.vcpu)) {
      delete nextOverride.vcpu;
    }
    if (!isValidOverrideNumber(nextOverride.interfaceCount)) {
      delete nextOverride.interfaceCount;
    }

    if (
      nextOverride.deviceRoleIcon !== undefined &&
      !DeviceRoleIconSchema.safeParse(nextOverride.deviceRoleIcon).success
    ) {
      delete nextOverride.deviceRoleIcon;
    }

    if (Object.keys(nextOverride).length > 0) {
      sanitized[templateId] = nextOverride;
    }
  }

  return sanitized;
}

function isValidOverrideNumber(value: number | undefined): boolean {
  return value === undefined || (Number.isInteger(value) && value >= 0);
}

export function saveTemplateOverrides(overrides: TemplateOverrideMap): void {
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(templateOverridesFile(), JSON.stringify(overrides, null, 2));
}
