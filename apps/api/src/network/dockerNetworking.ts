import type { LabDocument } from "@networkchum/shared";

export function dockerNetworkName(networkId: string): string {
  return `nc-net-${networkId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function buildDockerNetworkCreateCommand(networkId: string): string[] {
  return [
    "docker",
    "network",
    "create",
    "--driver",
    "bridge",
    dockerNetworkName(networkId),
  ];
}

export function buildDockerNetworkConnectCommand(
  networkId: string,
  containerName: string,
): string[] {
  return [
    "docker",
    "network",
    "connect",
    dockerNetworkName(networkId),
    containerName,
  ];
}

export function buildDockerNetworkDisconnectCommand(
  networkId: string,
  containerName: string,
): string[] {
  return [
    "docker",
    "network",
    "disconnect",
    dockerNetworkName(networkId),
    containerName,
    "--force",
  ];
}

export function buildDockerNetworkRemoveCommand(networkId: string): string[] {
  return ["docker", "network", "rm", dockerNetworkName(networkId)];
}

export function getNodeAttachmentsForContainer(
  document: LabDocument,
  nodeId: string,
): Array<{ networkId: string; slot: number }> {
  const node = document.nodes.find((n) => n.id === nodeId);
  if (!node) return [];

  const result: Array<{ networkId: string; slot: number }> = [];

  for (const attachment of document.attachments) {
    const iface = node.interfaces.find((i) => i.id === attachment.interfaceId);
    if (iface) {
      result.push({ networkId: attachment.networkId, slot: iface.slot });
    }
  }

  return result.sort((a, b) => a.slot - b.slot);
}
