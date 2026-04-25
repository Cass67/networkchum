import { XMLParser } from "fast-xml-parser";
import type { ImportIssue } from "@networkchum/shared";

import { asArray, gridPosition, numericValue } from "./normalize.js";
import type {
  NormalizedImportedLink,
  NormalizedImportedNetwork,
  NormalizedImportedNode,
  NormalizedImportedTopology,
  TopologyPayload,
} from "./types.js";

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
});

function objectValue(value: unknown): XmlRecord {
  return value && typeof value === "object" ? (value as XmlRecord) : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    return stringValue((value as XmlRecord)["#text"]);
  }
  return null;
}

function collectInterfaces(node: XmlRecord): XmlRecord[] {
  const interfacesRoot = objectValue(node.interfaces);
  return [
    ...asArray(interfacesRoot.interface as XmlRecord | XmlRecord[]),
    ...asArray(node.interface as XmlRecord | XmlRecord[]),
  ].map(objectValue);
}

function interfaceNames(node: XmlRecord, interfaces: XmlRecord[]): string[] {
  const explicit = interfaces
    .map((iface) => stringValue(iface.name))
    .filter((name): name is string => Boolean(name));
  if (explicit.length > 0) return explicit;

  const ethernetCount = numericValue(node.ethernet) ?? 1;
  return Array.from({ length: Math.max(1, ethernetCount) }, (_, index) =>
    index === 0 ? "eth0" : `eth${index}`,
  );
}

function runtimeHint(node: XmlRecord): NormalizedImportedNode["runtimeHint"] {
  const raw = `${stringValue(node.type) ?? ""} ${
    stringValue(node.template) ?? ""
  }`.toLowerCase();
  if (/cloud|network|nat/.test(raw)) return "cloud";
  if (/docker|container/.test(raw)) return "container";
  return "qemu";
}

function startupConfig(node: XmlRecord): string | undefined {
  const configsRoot = objectValue(node.configs);
  const configs = asArray(configsRoot.config as unknown).map(textValue);
  return (
    configs.find((config): config is string => Boolean(config)) ?? undefined
  );
}

export function parseEveUnlTopology(
  payload: TopologyPayload,
): NormalizedImportedTopology {
  const parsed = parser.parse(payload.content) as XmlRecord;
  const lab = objectValue(parsed.lab ?? parsed.unl ?? parsed);
  const topology = objectValue(lab.topology);
  const nodesRoot = objectValue(topology.nodes ?? lab.nodes);
  const xmlNodes = asArray(nodesRoot.node as XmlRecord | XmlRecord[]).map(
    objectValue,
  );
  const networksRoot = objectValue(topology.networks ?? lab.networks);
  const networks = new Map<string, string>();
  for (const network of asArray(
    networksRoot.network as XmlRecord | XmlRecord[],
  ).map(objectValue)) {
    const id = stringValue(network.id);
    if (id) {
      networks.set(id, stringValue(network.name) ?? `network-${id}`);
    }
  }

  const issues: ImportIssue[] = payload.ignoredFiles.map((fileName) => ({
    severity: "info" as const,
    message: `Ignored packaged file ${fileName}`,
  }));
  const attachmentByNetwork = new Map<
    string,
    Array<{ nodeId: string; interfaceName: string }>
  >();

  const nodes = xmlNodes.flatMap((node, index): NormalizedImportedNode[] => {
    const foreignId = stringValue(node.id);
    if (!foreignId) {
      issues.push({
        severity: "warning",
        message: "Skipped node without an id.",
      });
      return [];
    }

    const interfaces = collectInterfaces(node);
    for (const iface of interfaces) {
      const networkId = stringValue(iface.network_id);
      const name = stringValue(iface.name);
      if (!networkId || networkId === "0" || !name) continue;
      const entries = attachmentByNetwork.get(networkId) ?? [];
      entries.push({ nodeId: foreignId, interfaceName: name });
      attachmentByNetwork.set(networkId, entries);
    }

    const fallback = gridPosition(index);
    return [
      {
        foreignId,
        name: stringValue(node.name) ?? `node-${foreignId}`,
        templateName: stringValue(node.template) ?? stringValue(node.type),
        imageName:
          stringValue(node.image) ??
          stringValue(node.qemu_image) ??
          stringValue(node.icon),
        runtimeHint: runtimeHint(node),
        position: {
          x: numericValue(node.left) ?? fallback.x,
          y: numericValue(node.top) ?? fallback.y,
        },
        ramMb: numericValue(node.ram),
        vcpu: numericValue(node.cpu),
        interfaceNames: interfaceNames(node, interfaces),
        startupConfig: startupConfig(node),
      },
    ];
  });

  const links: NormalizedImportedLink[] = [];
  const importedNetworks: NormalizedImportedNetwork[] = [];
  for (const [networkId, endpoints] of attachmentByNetwork) {
    if (endpoints.length < 2) {
      issues.push({
        severity: "warning",
        message: `Skipped one-ended network ${networks.get(networkId) ?? networkId}.`,
      });
      continue;
    }
    importedNetworks.push({
      name: networks.get(networkId) ?? `network-${networkId}`,
      endpoints: endpoints.map((endpoint) => ({
        nodeId: endpoint.nodeId,
        interfaceName: endpoint.interfaceName,
      })),
    });
    if (endpoints.length !== 2) continue;
    links.push({
      sourceNodeId: endpoints[0]!.nodeId,
      sourceInterface: endpoints[0]!.interfaceName,
      targetNodeId: endpoints[1]!.nodeId,
      targetInterface: endpoints[1]!.interfaceName,
      networkName: networks.get(networkId),
    });
  }

  return {
    source: {
      format: payload.format,
      fileName: payload.originalFileName,
      topologyPath: payload.topologyPath,
    },
    name:
      stringValue(lab.name) ??
      payload.topologyPath.replace(/\.(unl|xml)$/i, "") ??
      "Imported Lab",
    nodes,
    links,
    networks: importedNetworks,
    issues,
  };
}
