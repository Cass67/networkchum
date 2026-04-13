import type { Template } from "@networkchum/shared";
import { z } from "zod";

export type DeviceRoleIcon = Template["deviceRoleIcon"];

export const DeviceRoleIconSchema = z.enum([
  "router",
  "switch",
  "firewall",
  "cloud",
  "host",
  "client",
]);

type DeviceRoleGuessInput = {
  runtime?: Template["runtime"] | null;
  vendor?: string | null;
  name?: string | null;
  templateId?: string | null;
};

const CLOUD_KEYWORDS = ["cloud", "internet", "mgmt"];
const FIREWALL_KEYWORDS = [
  "asa",
  "asav",
  "srx",
  "vsrx",
  "fortigate",
  "fortios",
  "panos",
  "palo alto",
  "checkpoint",
];
const SWITCH_KEYWORDS = [
  "veos",
  "eos",
  "iosvl2",
  "nx-os",
  "nxos",
  "switch",
  "cat9k",
  "catalyst",
];
const ROUTER_KEYWORDS = [
  "csr",
  "iosv",
  "router",
  "asr",
  "isr",
  "xr",
  "junos",
  "vmx",
  "vyos",
];
const HOST_KEYWORDS = ["alpine", "ubuntu", "debian", "linux", "server", "host"];
const CLIENT_KEYWORDS = ["client", "workstation", "desktop", "pc"];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesKeywords(normalizedValue: string, keywords: string[]): boolean {
  const valueTokens = normalizedValue.split(" ").filter(Boolean);

  return keywords.some((keyword) => {
    const normalizedKeyword = normalize(keyword);
    if (normalizedKeyword.includes(" ")) {
      return normalizedValue.includes(normalizedKeyword);
    }

    return valueTokens.some(
      (token) =>
        token === normalizedKeyword || token.startsWith(normalizedKeyword),
    );
  });
}

function tokens(value: string): Set<string> {
  if (!value) {
    return new Set();
  }
  return new Set(value.split(" ").filter(Boolean));
}

export function guessDeviceRoleIcon(
  input: DeviceRoleGuessInput,
): DeviceRoleIcon {
  const name = input.name ?? "";
  const vendor = input.vendor ?? "";
  const templateId = input.templateId ?? "";
  const runtime = input.runtime ?? undefined;

  const nameNormalized = normalize(name);
  const templateNormalized = normalize(templateId);

  const combinedNormalized = normalize(`${vendor} ${name} ${templateId}`);

  if (
    runtime === "cloud" ||
    templateNormalized.includes("cloud") ||
    matchesKeywords(nameNormalized, CLOUD_KEYWORDS)
  ) {
    return "cloud";
  }

  if (matchesKeywords(combinedNormalized, FIREWALL_KEYWORDS)) {
    return "firewall";
  }

  if (matchesKeywords(combinedNormalized, SWITCH_KEYWORDS)) {
    return "switch";
  }

  if (matchesKeywords(combinedNormalized, ROUTER_KEYWORDS)) {
    return "router";
  }

  if (
    runtime === "container" ||
    matchesKeywords(nameNormalized, HOST_KEYWORDS)
  ) {
    return "host";
  }

  const nameTokens = tokens(nameNormalized);
  if (CLIENT_KEYWORDS.some((keyword) => nameTokens.has(keyword))) {
    return "client";
  }

  return "router";
}
