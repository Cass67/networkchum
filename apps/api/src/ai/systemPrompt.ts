import type { ImageRecord, Template } from "@networkchum/shared";

function catalogLine(template: Template, imageBound: boolean): string {
  const limits = template.configSchema;
  const interfaces = template.interfaceNames?.length
    ? `names: ${template.interfaceNames.slice(0, 4).join(", ")}${
        template.interfaceNames.length > 4 ? ", …" : ""
      }`
    : "names: eth0, eth1, …";
  const imageNote =
    template.runtime === "qemu"
      ? imageBound
        ? "image bound ✓"
        : "NO IMAGE BOUND (node cannot power on; prefer another template unless the user insists)"
      : "container";
  return [
    `- \`templateId: ${template.id}\` — ${template.vendor} ${template.displayName}`,
    `role icon: ${template.deviceRoleIcon}, runtime: ${template.runtime}`,
    `vcpu ${limits.vcpu.min}-${limits.vcpu.max} (default ${limits.vcpu.default})`,
    `ramMb ${limits.ramMb.min}-${limits.ramMb.max} (default ${limits.ramMb.default})`,
    `interfaces ${limits.interfaceCount.min}-${limits.interfaceCount.max} (default ${limits.interfaceCount.max}), ${interfaces}`,
    imageNote,
  ].join(" | ");
}

/**
 * The system prompt turns the model into a lab-planning specialist whose only
 * job is emitting an AiLabSpec JSON document. The live catalog is injected so
 * the model can only pick template ids that actually exist in this
 * installation.
 */
export function buildSystemPrompt(input: {
  templates: Template[];
  images: ImageRecord[];
  // When the user hand-picked devices in the dialog, the catalog narrows to
  // exactly those and the prompt demands one node per selected device.
  devices?: Array<string>;
}): string {
  const boundTemplateIds = new Set(
    input.images
      .filter((image) => image.catalogState === "active" && image.templateId)
      .map((image) => image.templateId),
  );
  const selectedTemplates =
    input.devices && input.devices.length > 0
      ? input.templates.filter((template) =>
          input.devices!.includes(template.id),
        )
      : input.templates;
  const deviceConstraint =
    input.devices && input.devices.length > 0
      ? `\n## Selected devices (hard constraint)\n\nThe user hand-picked these devices in the dialog. Every node in \"nodes\" MUST use one of these templateId values, and the node list must cover the selected devices exactly as the user's request asks (e.g. two routers of the same model = two nodes with that templateId). Do not add any node whose templateId is not in this list:\n\n${input.devices
          .map((id) => `- ${id}`)
          .join("\n")}\n`
      : "";
  const catalog = selectedTemplates
    .filter(
      (template) =>
        template.runtime === "qemu" || template.runtime === "container",
    )
    .map((template) => catalogLine(template, boundTemplateIds.has(template.id)))
    .join("\n");

  return `You are a senior network engineer working inside NetworkChum, a browser-based network lab workbench. Your one and only task is to convert the user's lab request into a JSON lab spec. You do not explain, you do not write device configs, you do not choose disk images, you do not invent products outside the catalog.

Respond with a single JSON object and nothing else: no markdown fences, no commentary, no trailing notes.

## Output contract

{
  "name": string,                       // short lab name, e.g. "Three-Router Triangle"
  "description": string (optional),     // one-sentence summary of the design
  "nodes": [
    {
      "name": string,                   // unique, short, no spaces preferred, e.g. "r1"
      "templateId": string,             // MUST come verbatim from the catalog below
      "role": string (optional),        // e.g. "core router", "mgmt host"
      "interfaceCount": number (optional),  // omit unless the design needs more than the default
      "vcpu": number (optional),
      "ramMb": number (optional)        // omit to use the template default; never exceed the catalog max
    }
  ],
  "links": [
    {
      "name": string (optional),        // defaults to link-N if omitted
      "members": [
        { "node": string, "interfaceIndex": number (optional) }
      ]                                  // 2+ members share one ethernet segment; omit interfaceIndex unless the design pins a specific slot
    }
  ]
}

## Hard rules

1. Every node's "templateId" must be copied verbatim from the catalog list below. If the user names a device you cannot map to a catalog entry, choose the closest catalog template and note what you mapped in "role".
2. Node names are unique across the spec. Link members reference nodes by "name", never by id.
3. Every link needs at least 2 members. Members of one link form a single broadcast segment (like a switch or a shared cable). To model a point-to-point link, give it exactly 2 members.
4. Never claim an interfaceIndex greater than or equal to the template's max interface count; prefer omitting interfaceIndex entirely and letting the builder assign free slots in order.
5. Use container templates freely (no image needed). For qemu templates the catalog marks whether an image is bound; a node on an unbound qemu template cannot power on, so prefer a bound alternative when the design allows it.
6. Do not include cloud or lab-bridge nodes; this builder only supports qemu and container templates.
7. Keep the design minimal: only the nodes and links the request needs. Do not add management networks, out-of-band segments, or extra hosts unless the user asked for them.
8. Output ONLY the JSON object.

## Worked example

Request: "two XRv9k routers connected to one Ubuntu host, routers also link to each other"

{
  "name": "XRv9k Pair with Host",
  "description": "Two Cisco XRv9k routers peering with each other and sharing one Ubuntu host.",
  "nodes": [
    { "name": "r1", "templateId": "cisco-xrv9k", "role": "core router" },
    { "name": "r2", "templateId": "cisco-xrv9k", "role": "core router" },
    { "name": "host1", "templateId": "linux-ubuntu-container", "role": "test host" }
  ],
  "links": [
    { "name": "r1-r2", "members": [ { "node": "r1", "interfaceIndex": 0 }, { "node": "r2", "interfaceIndex": 0 } ] },
    { "name": "lan-1", "members": [ { "node": "r1", "interfaceIndex": 1 }, { "node": "r2", "interfaceIndex": 1 }, { "node": "host1" } ] }
  ]
}

${deviceConstraint}\n## Device catalog (use these templateId values verbatim)

${catalog}
`;
}
