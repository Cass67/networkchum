export const MACOS_MANAGEMENT_SUBNET_CIDR = "172.31.255.0/24";
export const MACOS_MANAGEMENT_HOST_IP = "172.31.255.1";

export const MACOS_MANAGEMENT_SUBNET = {
  subnetCidr: MACOS_MANAGEMENT_SUBNET_CIDR,
  hostIp: MACOS_MANAGEMENT_HOST_IP,
} as const;

export type MacOsManagementSubnet = typeof MACOS_MANAGEMENT_SUBNET;

export const MACOS_MANAGEMENT_UNAVAILABLE_MESSAGE =
  "Management cloud on macOS requires the host-only management backend, but it is unavailable on this host.";

export function getMacOsManagementSubnet(): MacOsManagementSubnet {
  return MACOS_MANAGEMENT_SUBNET;
}

export function buildMacOsManagementUnavailableMessage() {
  return MACOS_MANAGEMENT_UNAVAILABLE_MESSAGE;
}
