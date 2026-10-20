import { existsSync, readFileSync, writeFileSync } from "node:fs";

import type {
  AiProviderSettings,
  AiProviderSettingsView,
} from "@networkchum/shared";
import { AiProviderSettingsSchema } from "@networkchum/shared";

import { getDataFile } from "../storagePaths.js";

function settingsFile(): string {
  return getDataFile("ai-provider.json");
}

export function loadAiProviderSettings(): AiProviderSettings | null {
  if (!existsSync(settingsFile())) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(settingsFile(), "utf8"));
    const parsed = AiProviderSettingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveAiProviderSettings(settings: AiProviderSettings): void {
  const parsed = AiProviderSettingsSchema.parse(settings);
  writeFileSync(settingsFile(), JSON.stringify(parsed, null, 2));
}

// Never hand the raw key back to a caller that persists it in a response.
export function toProviderSettingsView(
  settings: AiProviderSettings,
): AiProviderSettingsView {
  const { apiKey: _apiKey, ...rest } = settings;
  return { ...rest, hasApiKey: typeof _apiKey === "string" };
}
