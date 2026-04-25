import type { ImportIssue } from "@networkchum/shared";

import { gridPosition, numericValue } from "./normalize.js";
import type {
  NormalizedImportedLink,
  NormalizedImportedNetwork,
  NormalizedImportedNode,
  NormalizedImportedTopology,
  TopologyPayload,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(objectValue) : [];
}

function portKey(endpoint: JsonRecord): string {
  return [
    stringValue(endpoint.node_id) ?? "",
    numericValue(endpoint.adapter_number) ?? 0,
    numericValue(endpoint.port_number) ?? 0,
  ].join(":");
}

function runtimeHint(node: JsonRecord): NormalizedImportedNode["runtimeHint"] {
  const nodeType = `${stringValue(node.node_type) ?? ""} ${
    stringValue(node.compute_id) ?? ""
  }`.toLowerCase();
  if (/docker|container/.test(nodeType)) return "container";
  if (/cloud|ethernet_switch|nat/.test(nodeType)) return "cloud";
  return "qemu";
}

export function parseGns3Topology(
  payload: TopologyPayload,
): NormalizedImportedTopology {
  const parsed = JSON.parse(payload.content) as JsonRecord;
  const topology = objectValue(parsed.topology);
  const rawNodes = asArray(topology.nodes);
  const rawLinks = asArray(topology.links);
  const issues: ImportIssue[] = payload.ignoredFiles.map((fileName) => ({
    severity: "info" as const,
    message: `Ignored packaged file ${fileName}`,
  }));
  const portNameByKey = new Map<string, string>();

  const nodes = rawNodes.flatMap((node, index): NormalizedImportedNode[] => {
    const foreignId = stringValue(node.node_id);
    if (!foreignId) {
      issues.push({
        severity: "warning",
        message: "Skipped GNS3 node without node_id.",
      });
      return [];
    }

    const properties = objectValue(node.properties);
    const ports = asArray(node.ports);
    const interfaceNames = ports.length
      ? ports.map((port) => {
          const name =
            stringValue(port.name) ??
            `eth${numericValue(port.port_number) ?? 0}`;
          portNameByKey.set(
            [
              foreignId,
              numericValue(port.adapter_number) ?? 0,
              numericValue(port.port_number) ?? 0,
            ].join(":"),
            name,
          );
          return name;
        })
      : ["eth0"];
    const fallback = gridPosition(index);

    return [
      {
        foreignId,
        name: stringValue(node.name) ?? `node-${foreignId}`,
        templateName:
          stringValue(node.template_id) ??
          stringValue(node.template_name) ??
          stringValue(node.node_type),
        imageName:
          stringValue(properties.hda_disk_image) ??
          stringValue(properties.qcow2) ??
          stringValue(properties.image),
        runtimeHint: runtimeHint(node),
        position: {
          x: numericValue(node.x) ?? fallback.x,
          y: numericValue(node.y) ?? fallback.y,
        },
        ramMb: numericValue(properties.ram),
        vcpu: numericValue(properties.cpus),
        interfaceNames,
      },
    ];
  });

  const nodeIds = new Set(nodes.map((node) => node.foreignId));
  const links: NormalizedImportedLink[] = [];
  const importedNetworks: NormalizedImportedNetwork[] = [];
  for (const link of rawLinks) {
    const endpoints = asArray(link.nodes);
    if (endpoints.length < 2) {
      issues.push({ severity: "warning", message: "Skipped one-ended link." });
      continue;
    }
    const source = endpoints[0]!;
    const target = endpoints[1]!;
    const sourceNodeId = stringValue(source.node_id);
    const targetNodeId = stringValue(target.node_id);
    if (
      !sourceNodeId ||
      !targetNodeId ||
      !nodeIds.has(sourceNodeId) ||
      !nodeIds.has(targetNodeId)
    ) {
      issues.push({
        severity: "warning",
        message: "Skipped link with missing endpoint node.",
      });
      continue;
    }
    const normalizedLink = {
      sourceNodeId,
      sourceInterface: portNameByKey.get(portKey(source)) ?? "eth0",
      targetNodeId,
      targetInterface: portNameByKey.get(portKey(target)) ?? "eth0",
      networkName: stringValue(link.link_id) ?? undefined,
    };
    links.push(normalizedLink);
    importedNetworks.push({
      name: normalizedLink.networkName ?? `link-${links.length}`,
      endpoints: [
        {
          nodeId: normalizedLink.sourceNodeId,
          interfaceName: normalizedLink.sourceInterface,
        },
        {
          nodeId: normalizedLink.targetNodeId,
          interfaceName: normalizedLink.targetInterface,
        },
      ],
    });
  }

  return {
    source: {
      format: payload.format,
      fileName: payload.originalFileName,
      topologyPath: payload.topologyPath,
    },
    name:
      stringValue(parsed.name) ??
      payload.topologyPath.replace(/\.gns3$/i, "") ??
      "Imported Lab",
    nodes,
    links,
    networks: importedNetworks,
    issues,
  };
}
