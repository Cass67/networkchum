import type {
  AiLabPreview,
  AiLabPreviewNode,
  AiLabSpec,
  ImageRecord,
  ImportIssue,
  LabDocument,
  Template,
} from "@networkchum/shared";
import { LabDocumentSchema, suggestTemplateId } from "@networkchum/shared";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nodeIdFor(name: string): string {
  return `node-ai-${name.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${randomSuffix()}`;
}

// Vendor shorthands the token matcher cannot reach, e.g. "eos" vs "veos".
const TEMPLATE_ALIASES: Array<[string, string]> = [
  ["eos", "arista-veos"],
  ["vmx", "juniper-vmx"],
];

type TokenizedTemplate = {
  template: Template;
  tokens: Array<string>;
};

function tokenize(value: string): Array<string> {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function matchTemplate(
  hint: string,
  templates: Array<TokenizedTemplate>,
): Template | undefined {
  const exact = templates.find(
    (entry) =>
      entry.template.id === hint ||
      entry.template.displayName.toLowerCase() === hint.toLowerCase(),
  );
  if (exact) {
    return exact.template;
  }

  const lower = hint.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!lower) {
    return undefined;
  }

  const aliasTarget = TEMPLATE_ALIASES.find(
    ([alias]) => lower === alias || lower.includes(alias),
  )?.[1];
  if (aliasTarget) {
    const aliased = templates.find(
      (entry) => entry.template.id === aliasTarget,
    );
    if (aliased) {
      return aliased.template;
    }
  }

  const suggested = suggestTemplateId(hint);
  if (suggested) {
    const suggestedEntry = templates.find(
      (entry) => entry.template.id === suggested,
    );
    if (suggestedEntry) {
      return suggestedEntry.template;
    }
  }

  // Token match: any catalog token starts with the hint or the hint starts
  // with a catalog token (e.g. "iosv" vs "cisco-iosv", "ubuntu" vs
  // "Ubuntu Container").
  return templates.find((entry) =>
    entry.tokens.some(
      (token) => token.startsWith(lower) || lower.startsWith(token),
    ),
  )?.template;
}

export type BuildLabDocumentFromSpecInput = {
  labId: string;
  spec: AiLabSpec;
  templates: Template[];
  images: ImageRecord[];
};

/**
 * Resolve an AiLabSpec against the live catalog and build a valid
 * LabDocument — the deterministic counterpart to the import pipeline's
 * buildLabDocumentFromImport. Pure: no I/O, no LLM calls, so preview and
 * commit produce identical documents from the same spec.
 */
export function buildLabDocumentFromSpec(
  input: BuildLabDocumentFromSpecInput,
): AiLabPreview {
  const issues: ImportIssue[] = [];
  const templates = input.templates.filter(
    (template) =>
      template.runtime === "qemu" || template.runtime === "container",
  );
  const tokenized = templates.map((template) => ({
    template,
    tokens: [
      ...tokenize(template.id),
      ...tokenize(template.displayName),
      ...tokenize(template.vendor),
    ],
  }));
  const imageByTemplateId = new Map<string, ImageRecord>();
  for (const image of input.images) {
    if (
      image.catalogState === "active" &&
      image.templateId &&
      !imageByTemplateId.has(image.templateId)
    ) {
      imageByTemplateId.set(image.templateId, image);
    }
  }

  // --- Resolve templates per node ---------------------------------------
  const specNodeByName = new Map<string, AiLabSpec["nodes"][number]>();
  const previewNodes: AiLabPreviewNode[] = [];
  const resolvedTemplateByNode = new Map<string, Template>();

  for (const specNode of input.spec.nodes) {
    if (specNodeByName.has(specNode.name)) {
      issues.push({
        severity: "error",
        message: `Duplicate node name "${specNode.name}"; the later node was dropped`,
        nodeName: specNode.name,
      });
      continue;
    }
    specNodeByName.set(specNode.name, specNode);

    const template = matchTemplate(specNode.templateId, tokenized);
    if (!template) {
      issues.push({
        severity: "error",
        message: `No template for "${specNode.templateId}". Available templates: ${templates
          .map((entry) => entry.id)
          .join(", ")}`,
        nodeName: specNode.name,
      });
      previewNodes.push({
        name: specNode.name,
        role: specNode.role,
        requestedTemplate: specNode.templateId,
        status: "unresolved",
        templateId: null,
        displayName: null,
        imageId: null,
        imageBound: false,
        interfaceCount: null,
      });
      continue;
    }

    const status =
      template.id === specNode.templateId
        ? ("matched" as const)
        : ("fuzzy-matched" as const);
    if (status === "fuzzy-matched") {
      issues.push({
        severity: "info",
        message: `"${specNode.templateId}" resolved to template ${template.id}`,
        nodeName: specNode.name,
      });
    }

    const image = imageByTemplateId.get(template.id) ?? null;
    if (template.runtime === "qemu" && !image) {
      issues.push({
        severity: "warning",
        message: `${template.displayName} has no bound image; the node will not power on until an image is bound`,
        nodeName: specNode.name,
      });
    }

    resolvedTemplateByNode.set(specNode.name, template);
    previewNodes.push({
      name: specNode.name,
      role: specNode.role,
      requestedTemplate: specNode.templateId,
      status,
      templateId: template.id,
      displayName: template.displayName,
      imageId: image?.id ?? null,
      imageBound: Boolean(image),
      interfaceCount: null,
    });
  }

  const anyUnresolved = previewNodes.some(
    (node) => node.status === "unresolved",
  );

  // --- Resolve link members into interface slots ------------------------
  const usedSlotsByNode = new Map<string, Set<number>>();
  for (const name of specNodeByName.keys()) {
    usedSlotsByNode.set(name, new Set());
  }

  const previewLinks: AiLabPreview["links"] = [];
  const linkMemberSlots: Array<
    Array<{ node: string; interfaceIndex: number }>
  > = [];

  input.spec.links.forEach((link, linkIndex) => {
    const resolvedMembers: Array<{ node: string; interfaceIndex: number }> = [];
    for (const member of link.members) {
      const used = usedSlotsByNode.get(member.node);
      if (!used) {
        // normalizeSpec drops unknown members; this is a defensive guard.
        continue;
      }
      let slot = member.interfaceIndex;
      if (slot !== undefined && used.has(slot)) {
        issues.push({
          severity: "warning",
          message: `${member.node} interface ${slot} is already in use; assigning the next free slot`,
          nodeName: member.node,
        });
        slot = undefined;
      }
      if (slot === undefined) {
        slot = 0;
        while (used.has(slot)) {
          slot += 1;
        }
      }
      used.add(slot);
      resolvedMembers.push({ node: member.node, interfaceIndex: slot });
    }
    linkMemberSlots.push(resolvedMembers);
    previewLinks.push({
      name: link.name ?? `link-${linkIndex + 1}`,
      members: resolvedMembers,
    });
  });

  // --- Build nodes (config clamping mirrors commitImport) ---------------
  const documentNodes: LabDocument["nodes"] = [];
  const interfaceIdByNodeAndSlot = new Map<string, string>();

  specNodeByName.forEach((specNode, name) => {
    const template = resolvedTemplateByNode.get(name);
    if (!template) {
      return;
    }
    const nodeId = nodeIdFor(name);
    const used = usedSlotsByNode.get(name)!;
    const maxUsedSlot = Math.max(-1, ...used);

    const declaredCount =
      specNode.interfaceCount ?? template.configSchema.interfaceCount.default;
    let interfaceCount = clamp(
      Math.max(declaredCount, maxUsedSlot + 1),
      template.configSchema.interfaceCount.min,
      template.configSchema.interfaceCount.max,
    );
    if (interfaceCount < maxUsedSlot + 1) {
      issues.push({
        severity: "warning",
        message: `${name} needs ${
          maxUsedSlot + 1
        } interfaces but template ${template.id} allows at most ${
          template.configSchema.interfaceCount.max
        }; links above that slot are dropped`,
        nodeName: name,
      });
      interfaceCount = template.configSchema.interfaceCount.max;
    }

    const interfaces = Array.from({ length: interfaceCount }, (_, index) => {
      const id = `if-${nodeId}-${index}`;
      interfaceIdByNodeAndSlot.set(`${name}:${index}`, id);
      return {
        id,
        name: template.interfaceNames?.[index] ?? `eth${index}`,
        slot: index,
      };
    });

    documentNodes.push({
      id: nodeId,
      name,
      runtime: template.runtime,
      templateId: template.id,
      imageId: imageByTemplateId.get(template.id)?.id ?? null,
      position: {
        x: 80 + (documentNodes.length % 4) * 160,
        y: 80 + Math.floor(documentNodes.length / 4) * 120,
      },
      config: {
        vcpu:
          specNode.vcpu &&
          specNode.vcpu >= template.configSchema.vcpu.min &&
          specNode.vcpu <= template.configSchema.vcpu.max
            ? specNode.vcpu
            : template.configSchema.vcpu.default,
        ramMb:
          specNode.ramMb &&
          specNode.ramMb >= template.configSchema.ramMb.min &&
          specNode.ramMb <= template.configSchema.ramMb.max
            ? specNode.ramMb
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
    });
  });

  for (const previewNode of previewNodes) {
    previewNode.interfaceCount =
      documentNodes.find((node) => node.name === previewNode.name)?.interfaces
        .length ?? null;
  }

  // --- Networks and attachments -----------------------------------------
  const networks: LabDocument["networks"] = [];
  const attachments: LabDocument["attachments"] = [];
  linkMemberSlots.forEach((resolvedMembers, linkIndex) => {
    if (resolvedMembers.length < 2) {
      return;
    }
    const networkId = `net-ai-${linkIndex}-${randomSuffix()}`;
    networks.push({
      id: networkId,
      kind: "ethernet" as const,
      name: previewLinks[linkIndex]?.name ?? `link-${linkIndex + 1}`,
      visible: false,
    });
    for (const member of resolvedMembers) {
      const interfaceId = interfaceIdByNodeAndSlot.get(
        `${member.node}:${member.interfaceIndex}`,
      );
      if (interfaceId) {
        attachments.push({ interfaceId, networkId });
      }
    }
  });

  const document: LabDocument | null = anyUnresolved
    ? null
    : LabDocumentSchema.parse({
        id: input.labId,
        name: input.spec.name,
        version: 1,
        canvas: { zoom: 1, backgroundImage: null, drawings: [] },
        nodes: documentNodes,
        networks,
        attachments,
        annotations: [],
        startupConfigSets: [],
        nodeBootActions: [],
        activeConfigSetId: null,
      });

  return {
    labName: input.spec.name,
    description: input.spec.description,
    spec: input.spec,
    nodes: previewNodes,
    links: previewLinks,
    issues,
    document,
  };
}
