import type {
  LabDocument,
  LabNode,
  StartupConfigSet,
  Template,
} from "@networkchum/shared";

type AddNodeInput = {
  template: Template;
  name: string;
  position: { x: number; y: number };
  imageId?: string | null;
  accelerationMode?: string;
};

export function addNode(
  document: LabDocument,
  input: AddNodeInput,
): LabDocument {
  const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const interfaceCount = input.template.configSchema.interfaceCount.default;
  const ifaceNames = input.template.interfaceNames;
  const interfaces = Array.from({ length: interfaceCount }, (_, index) => ({
    id: `if-${nodeId}-${index}`,
    name: ifaceNames?.[index] ?? `eth${index}`,
    slot: index,
  }));

  const node: LabNode = {
    id: nodeId,
    name: input.name,
    runtime: input.template.runtime,
    templateId: input.template.id,
    imageId: input.imageId ?? null,
    position: input.position,
    config: {
      vcpu: input.template.configSchema.vcpu.default,
      ramMb: input.template.configSchema.ramMb.default,
      interfaceCount,
      nicModel: input.template.boot.nicModel,
      accelerationMode:
        input.accelerationMode ?? input.template.boot.acceleration,
    },
    state: {
      desiredPower: "off",
    },
    interfaces,
  };

  return {
    ...document,
    nodes: [...document.nodes, node],
  };
}

export function addNetwork(
  document: LabDocument,
  input: { name: string; visible: boolean },
): LabDocument {
  const network = {
    id: `net-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "ethernet" as const,
    name: input.name,
    visible: input.visible,
  };

  return {
    ...document,
    networks: [...document.networks, network],
  };
}

export function detachInterface(
  document: LabDocument,
  interfaceId: string,
): LabDocument {
  return {
    ...document,
    attachments: document.attachments.filter(
      (a) => a.interfaceId !== interfaceId,
    ),
  };
}

export function moveNode(
  document: LabDocument,
  nodeId: string,
  position: { x: number; y: number },
): LabDocument {
  return {
    ...document,
    nodes: document.nodes.map((n) =>
      n.id === nodeId ? { ...n, position } : n,
    ),
  };
}

export function attachInterfaces(
  document: LabDocument,
  input: { networkId: string; interfaceIds: string[] },
): LabDocument {
  const nextAttachments = document.attachments.filter(
    (attachment) => !input.interfaceIds.includes(attachment.interfaceId),
  );

  for (const interfaceId of input.interfaceIds) {
    nextAttachments.push({ interfaceId, networkId: input.networkId });
  }

  return {
    ...document,
    attachments: nextAttachments,
  };
}

export function removeNode(document: LabDocument, nodeId: string): LabDocument {
  const interfaceIds = new Set(
    document.nodes
      .find((node) => node.id === nodeId)
      ?.interfaces.map((iface) => iface.id) ?? [],
  );

  return {
    ...document,
    nodes: document.nodes.filter((node) => node.id !== nodeId),
    attachments: document.attachments.filter(
      (attachment) => !interfaceIds.has(attachment.interfaceId),
    ),
  };
}

export function removeNetwork(
  document: LabDocument,
  networkId: string,
): LabDocument {
  return {
    ...document,
    networks: document.networks.filter((network) => network.id !== networkId),
    attachments: document.attachments.filter(
      (attachment) => attachment.networkId !== networkId,
    ),
  };
}

export function upsertStartupConfigSet(
  document: LabDocument,
  set: StartupConfigSet,
): LabDocument {
  const exists = document.startupConfigSets.some((s) => s.id === set.id);
  return {
    ...document,
    startupConfigSets: exists
      ? document.startupConfigSets.map((s) => (s.id === set.id ? set : s))
      : [...document.startupConfigSets, set],
  };
}

export function deleteStartupConfigSet(
  document: LabDocument,
  setId: string,
): LabDocument {
  return {
    ...document,
    startupConfigSets: document.startupConfigSets.filter((s) => s.id !== setId),
    activeConfigSetId:
      document.activeConfigSetId === setId ? null : document.activeConfigSetId,
  };
}

export function setActiveConfigSet(
  document: LabDocument,
  setId: string | null,
): LabDocument {
  return { ...document, activeConfigSetId: setId };
}

export function setNodeConfig(
  document: LabDocument,
  setId: string,
  nodeId: string,
  config: string,
): LabDocument {
  return {
    ...document,
    startupConfigSets: document.startupConfigSets.map((s) => {
      if (s.id !== setId) return s;
      const exists = s.nodeConfigs.some((nc) => nc.nodeId === nodeId);
      return {
        ...s,
        nodeConfigs: exists
          ? s.nodeConfigs.map((nc) =>
              nc.nodeId === nodeId ? { nodeId, config } : nc,
            )
          : [...s.nodeConfigs, { nodeId, config }],
      };
    }),
  };
}

export function removeNodeConfig(
  document: LabDocument,
  setId: string,
  nodeId: string,
): LabDocument {
  return {
    ...document,
    startupConfigSets: document.startupConfigSets.map((s) =>
      s.id === setId
        ? {
            ...s,
            nodeConfigs: s.nodeConfigs.filter((nc) => nc.nodeId !== nodeId),
          }
        : s,
    ),
  };
}
