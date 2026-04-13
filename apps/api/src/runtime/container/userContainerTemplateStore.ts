import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { TemplateSchema, type Template } from "@networkchum/shared";

import { getDataDir, getDataFile } from "../../storagePaths.js";

function userContainerTemplatesFile(): string {
  return getDataFile("container-templates.json");
}

export function listUserContainerTemplates(): Template[] {
  const file = userContainerTemplatesFile();
  if (!existsSync(file)) {
    return [];
  }

  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown[];
    return raw
      .map((entry) => TemplateSchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data)
      .filter((template) => template.runtime === "container");
  } catch {
    return [];
  }
}

function saveUserContainerTemplates(templates: Template[]): void {
  mkdirSync(getDataDir(), { recursive: true });
  writeFileSync(
    userContainerTemplatesFile(),
    JSON.stringify(templates, null, 2),
  );
}

export function saveUserContainerTemplate(template: Template): Template {
  const parsed = TemplateSchema.parse(template);
  if (parsed.runtime !== "container") {
    throw new Error("Only container templates may be saved in this store.");
  }

  const templates = listUserContainerTemplates().filter(
    (entry) => entry.id !== parsed.id,
  );
  templates.push(parsed);
  saveUserContainerTemplates(templates);
  return parsed;
}

export function updateUserContainerTemplate(
  templateId: string,
  updater: (template: Template) => Template,
): Template | null {
  const templates = listUserContainerTemplates();
  const index = templates.findIndex((entry) => entry.id === templateId);
  if (index < 0) {
    return null;
  }

  const updated = TemplateSchema.parse(updater(templates[index]!));
  templates[index] = updated;
  saveUserContainerTemplates(templates);
  return updated;
}
