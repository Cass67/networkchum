export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function normalizeKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\.(qcow2|img|bin|vmdk)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function importedTemplateKey(input: {
  runtimeHint: string | null;
  templateName: string | null;
  imageName: string | null;
}): string {
  return [
    input.runtimeHint ?? "unknown",
    normalizeKey(input.templateName) || "unknown-template",
    normalizeKey(input.imageName) || "unknown-image",
  ].join(":");
}

export function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function gridPosition(index: number): { x: number; y: number } {
  return {
    x: 96 + (index % 5) * 180,
    y: 96 + Math.floor(index / 5) * 140,
  };
}
