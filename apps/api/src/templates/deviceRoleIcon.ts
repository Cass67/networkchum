import type { Template } from "@networkchum/shared";

export type DeviceRoleIcon = Template["deviceRoleIcon"];

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

function compact(value: string): string {
  return value.replace(/\s+/g, "");
}

function matchesKeywords(
  normalizedValue: string,
  compactValue: string,
  keywords: string[],
): boolean {
  return keywords.some((keyword) => {
    if (keyword.includes(" ")) {
      return normalizedValue.includes(keyword);
    }
    return compactValue.includes(keyword);
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
  const nameCompact = compact(nameNormalized);
  const templateNormalized = normalize(templateId);

  const combinedNormalized = normalize(`${vendor} ${name} ${templateId}`);
  const combinedCompact = compact(combinedNormalized);

  if (
    runtime === "cloud" ||
    templateNormalized.includes("cloud") ||
    matchesKeywords(nameNormalized, nameCompact, CLOUD_KEYWORDS)
  ) {
    return "cloud";
  }

  if (matchesKeywords(combinedNormalized, combinedCompact, FIREWALL_KEYWORDS)) {
    return "firewall";
  }

  if (matchesKeywords(combinedNormalized, combinedCompact, SWITCH_KEYWORDS)) {
    return "switch";
  }

  if (matchesKeywords(combinedNormalized, combinedCompact, ROUTER_KEYWORDS)) {
    return "router";
  }

  if (
    runtime === "container" ||
    matchesKeywords(nameNormalized, nameCompact, HOST_KEYWORDS)
  ) {
    return "host";
  }

  const nameTokens = tokens(nameNormalized);
  if (CLIENT_KEYWORDS.some((keyword) => nameTokens.has(keyword))) {
    return "client";
  }

  return "router";
}
