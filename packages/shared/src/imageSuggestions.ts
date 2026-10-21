/**
 * Best-effort template suggestion from a disk-image file name.
 * Shared so the API scan and the web upload wizard agree on the guess.
 */
export function suggestTemplateId(fileName: string): string | null {
  const lower = fileName.toLowerCase();

  if (lower.includes("csr1000v") || lower.includes("csr1000")) {
    return "cisco-asr";
  }
  if (lower.includes("asr") || lower.includes("iosxe")) {
    return "cisco-asr";
  }
  if (lower.includes("iosv") || lower.includes("vios")) {
    if (lower.includes("l2") || lower.includes("switch")) {
      return "cisco-vios-switch";
    }
    return "cisco-vios";
  }
  if (lower.includes("nxos") || lower.includes("nexus")) {
    return "cisco-nxosv";
  }
  if (lower.includes("xrv9k") || lower.includes("xrv9000")) {
    return "cisco-xrv9k";
  }
  if (lower.includes("xrv")) {
    return "cisco-xrv";
  }
  if (lower.includes("asav") || lower.includes("asa")) {
    return "cisco-asav";
  }
  if (lower.includes("ftd") || lower.includes("firepower")) {
    return "cisco-ftd";
  }
  if (lower.includes("c8000") || lower.includes("catalyst8000")) {
    return "cisco-catalyst-8000v";
  }
  if (
    lower.includes("cat9k") ||
    lower.includes("catalyst9000") ||
    lower.includes("c9kv")
  ) {
    return "cisco-catalyst-9000v";
  }
  if (lower.includes("ise")) {
    return "cisco-ise";
  }
  if (lower.includes("vsrx30") || lower.includes("vsrx3")) {
    return "juniper-vsrx30";
  }
  if (lower.includes("vsrxng") || lower.includes("vsrx-ng")) {
    return "juniper-vsrx-ng";
  }
  if (lower.includes("vsrx")) {
    return "juniper-vsrx";
  }
  if (
    lower.includes("vjunos") ||
    lower.includes("junosevo") ||
    lower.includes("evolved") ||
    lower.includes("vrr") ||
    lower.includes("vjuniper")
  ) {
    return "juniper-vrr";
  }
  if (lower.includes("vmxvfp") || lower.includes("vfp")) {
    return "juniper-vmx-vfp";
  }
  if (lower.includes("vmxvcp") || lower.includes("vcp")) {
    return "juniper-vmx-vcp";
  }
  if (lower.includes("vmx")) {
    return "juniper-vmx";
  }
  if (
    lower.includes("vqfxpfe") ||
    lower.includes("qfx-pfe") ||
    lower.includes("vqfxpfe")
  ) {
    return "juniper-vqfx-pfe";
  }
  if (
    lower.includes("vqfxre") ||
    lower.includes("qfx-re") ||
    lower.includes("vqfxre")
  ) {
    return "juniper-vqfx-re";
  }
  if (lower.includes("crpd") || lower.includes("c-rpd")) {
    return "juniper-crpd";
  }
  if (lower.includes("veos") || lower.includes("arista")) {
    return "arista-veos";
  }
  if (lower.includes("fortigate") || lower.includes("fortinet")) {
    return "fortinet-fortigate";
  }
  if (lower.includes("paloalto") || lower.includes("pan-")) {
    return "paloalto-vm";
  }
  if (lower.includes("pfsense")) {
    return "pfsense";
  }
  if (lower.includes("opnsense")) {
    return "opnsense";
  }
  if (lower.includes("vyos")) {
    return "vyos";
  }
  if (lower.includes("mikrotik") || lower.includes("routeros")) {
    return "mikrotik-routeros";
  }
  if (lower.includes("cumulus")) {
    return "cumulus-vx";
  }
  if (lower.includes("bigip") || lower.includes("f5")) {
    return "f5-bigip";
  }
  if (lower.includes("netscaler") || lower.includes("nsvpx")) {
    return "netscaler-vpx";
  }
  if (lower.includes("freebsd")) {
    return "freebsd";
  }
  if (lower.includes("alpine")) {
    return "linux-alpine-container";
  }
  if (lower.includes("ubuntu")) {
    return "linux-ubuntu-container";
  }

  return null;
}
