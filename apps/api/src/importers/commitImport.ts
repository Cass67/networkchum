import type { LabDocument, Template } from "@networkchum/shared";
import { LabDocumentSchema } from "@networkchum/shared";

import { importedTemplateKey } from "./normalize.js";
import type { NormalizedImportedTopology } from "./types.js";

export type ResolvedImportMapping = {
  template: Template;
  imageId?: string | null;
};

type BuildLabDocumentInput = {
  labId: string;
  labName: string;
  topology: NormalizedImportedTopology;
  resolvedMappings: Map<string, ResolvedImportMapping>;
  excludedNodeIds?: string[];
};

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nodeIdFor(foreignId: string): string {
  return `node-import-${foreignId.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${randomSuffix()}`;
}

export function buildLabDocumentFromImport(
  input: BuildLabDocumentInput,
): LabDocument {
  const nodeIdByForeignId = new Map<string, string>();
  const interfaceIdByNodeAndName = new Map<string, string>();
  const excludedNodeIds = new Set(input.excludedNodeIds ?? []);
  const importedNodes = input.topology.nodes.filter(
    (node) => !excludedNodeIds.has(node.foreignId),
  );
  const importedLinks = input.topology.links.filter(
    (link) =>
      !excludedNodeIds.has(link.sourceNodeId) &&
      !excludedNodeIds.has(link.targetNodeId),
  );

  const nodes = importedNodes.map((importedNode) => {
    const mapping = input.resolvedMappings.get(
      importedTemplateKey(importedNode),
    );
    if (!mapping) {
      throw new Error(`Missing import mapping for ${importedNode.name}`);
    }

    const nodeId = nodeIdFor(importedNode.foreignId);
    nodeIdByForeignId.set(importedNode.foreignId, nodeId);
    const template = mapping.template;
    const interfaceCount = clamp(
      Math.max(1, importedNode.interfaceNames.length),
      template.configSchema.interfaceCount.min,
      template.configSchema.interfaceCount.max,
    );
    const interfaces = Array.from({ length: interfaceCount }, (_, index) => {
      const name =
        importedNode.interfaceNames[index] ??
        template.interfaceNames?.[index] ??
        `eth${index}`;
      const id = `if-${nodeId}-${index}`;
      interfaceIdByNodeAndName.set(`${importedNode.foreignId}:${name}`, id);
      return { id, name, slot: index };
    });

    return {
      id: nodeId,
      name: importedNode.name,
      runtime: template.runtime,
      templateId: template.id,
      imageId: mapping.imageId ?? null,
      position: importedNode.position,
      config: {
        vcpu:
          importedNode.vcpu &&
          importedNode.vcpu >= template.configSchema.vcpu.min &&
          importedNode.vcpu <= template.configSchema.vcpu.max
            ? importedNode.vcpu
            : template.configSchema.vcpu.default,
        ramMb:
          importedNode.ramMb &&
          importedNode.ramMb >= template.configSchema.ramMb.min &&
          importedNode.ramMb <= template.configSchema.ramMb.max
            ? importedNode.ramMb
            : template.configSchema.ramMb.default,
        interfaceCount,
        nicModel: template.boot.nicModel,
        accelerationMode: template.boot.acceleration,
        bridgeInterface: null,
        containerImageRef: template.container?.imageRef,
        containerRegistry: template.container?.registry,
        containerEngine: template.container?.engine,
        containerShell: template.container?.defaultShell,
      },
      state: { desiredPower: "off" as const },
      interfaces,
    };
  });

  const networks = importedLinks.map((link, index) => ({
    id: `net-import-${index}-${randomSuffix()}`,
    kind: "ethernet" as const,
    name: link.networkName || `link-${index + 1}`,
    visible: false,
  }));

  const attachments = importedLinks.flatMap((link, index) => {
    const network = networks[index]!;
    const sourceInterfaceId = interfaceIdByNodeAndName.get(
      `${link.sourceNodeId}:${link.sourceInterface}`,
    );
    const targetInterfaceId = interfaceIdByNodeAndName.get(
      `${link.targetNodeId}:${link.targetInterface}`,
    );
    return [sourceInterfaceId, targetInterfaceId]
      .filter((interfaceId): interfaceId is string => Boolean(interfaceId))
      .map((interfaceId) => ({ interfaceId, networkId: network.id }));
  });

  const startupNodeConfigs = importedNodes.flatMap((node) => {
    if (!node.startupConfig) return [];
    const nodeId = nodeIdByForeignId.get(node.foreignId);
    return nodeId ? [{ nodeId, config: node.startupConfig }] : [];
  });

  const document: LabDocument = {
    id: input.labId,
    name: input.labName,
    version: 1,
    canvas: { zoom: 1, backgroundImage: null, drawings: [] },
    nodes,
    networks,
    attachments,
    annotations: [],
    startupConfigSets:
      startupNodeConfigs.length > 0
        ? [
            {
              id: "cfg-imported-default",
              name: "Imported startup configs",
              nodeConfigs: startupNodeConfigs,
            },
          ]
        : [],
    nodeBootActions: [],
    activeConfigSetId:
      startupNodeConfigs.length > 0 ? "cfg-imported-default" : null,
  };

  return LabDocumentSchema.parse(document);
}
