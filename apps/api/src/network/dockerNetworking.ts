import type { LabDocument } from "@networkchum/shared";

export function dockerNetworkName(networkId: string): string {
  return `nc-net-${networkId}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function buildDockerNetworkCreateCommand(
  networkId: string,
  engine: "docker" | "podman" = "docker",
): string[] {
  return [
    engine,
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
  engine: "docker" | "podman" = "docker",
): string[] {
  return [
    engine,
    "network",
    "connect",
    dockerNetworkName(networkId),
    containerName,
  ];
}

export function buildDockerNetworkDisconnectCommand(
  networkId: string,
  containerName: string,
  engine: "docker" | "podman" = "docker",
): string[] {
  return [
    engine,
    "network",
    "disconnect",
    dockerNetworkName(networkId),
    containerName,
    "--force",
  ];
}

export function buildDockerNetworkRemoveCommand(
  networkId: string,
  engine: "docker" | "podman" = "docker",
): string[] {
  return [engine, "network", "rm", dockerNetworkName(networkId)];
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
