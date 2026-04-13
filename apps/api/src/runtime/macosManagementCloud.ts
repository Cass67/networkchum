const MACOS_MANAGEMENT_SUBNET_CIDR = "172.31.255.0/24";
const MACOS_MANAGEMENT_HOST_IP = "172.31.255.1";

export function getMacOsManagementSubnet() {
  return {
    subnetCidr: MACOS_MANAGEMENT_SUBNET_CIDR,
    hostIp: MACOS_MANAGEMENT_HOST_IP,
  };
}

export function buildMacOsManagementUnavailableMessage() {
  return "Management cloud on macOS requires the host-only management backend, but it is unavailable on this host.";
}
