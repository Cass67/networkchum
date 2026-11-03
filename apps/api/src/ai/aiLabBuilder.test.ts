import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AiLabPreview, ImageRecord, Template } from "@networkchum/shared";
import { LabDocumentSchema } from "@networkchum/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { buildLabDocumentFromSpec } from "./buildLabDocumentFromSpec.js";
import { extractJsonObject, parseSpecJson } from "./generateLabSpec.js";

type App = ReturnType<typeof buildApp>;

const routerTemplate: Template = {
  id: "cisco-xrv9k",
  runtime: "qemu",
  displayName: "Cisco IOS-XRv 9000",
  vendor: "Cisco",
  deviceRoleIcon: "router",
  boot: { console: "serial", acceleration: "tcg", nicModel: "e1000" },
  configSchema: {
    ramMb: { default: 4096, min: 1024, max: 65536 },
    vcpu: { default: 2, min: 1, max: 16 },
    interfaceCount: { default: 2, min: 2, max: 8 },
  },
  interfaceNames: [
    "GigabitEthernet0/0/0/0",
    "GigabitEthernet0/0/0/1",
    "GigabitEthernet0/0/0/2",
    "GigabitEthernet0/0/0/3",
    "GigabitEthernet0/0/0/4",
    "GigabitEthernet0/0/0/5",
    "GigabitEthernet0/0/0/6",
    "GigabitEthernet0/0/0/7",
  ],
};

const hostTemplate: Template = {
  id: "linux-ubuntu-container",
  runtime: "container",
  displayName: "Ubuntu Container",
  vendor: "Ubuntu",
  deviceRoleIcon: "host",
  boot: { console: "none", acceleration: "none" },
  configSchema: {
    ramMb: { default: 512, min: 128, max: 4096 },
    vcpu: { default: 1, min: 1, max: 4 },
    interfaceCount: { default: 1, min: 1, max: 4 },
  },
  container: {
    imageRef: "ubuntu:22.04",
    registry: "docker.io",
    engine: "docker",
    defaultShell: "/bin/bash",
  },
};

const eosTemplate: Template = {
  id: "arista-veos",
  runtime: "qemu",
  displayName: "Arista vEOS",
  vendor: "Arista",
  deviceRoleIcon: "switch",
  boot: { console: "serial", acceleration: "tcg", nicModel: "e1000" },
  configSchema: {
    ramMb: { default: 4096, min: 1024, max: 65536 },
    vcpu: { default: 1, min: 1, max: 8 },
    interfaceCount: { default: 4, min: 1, max: 8 },
  },
};

const asrTemplate: Template = {
  ...routerTemplate,
  id: "cisco-asr",
  displayName: "Cisco CSR 1000v",
  boot: {
    ...routerTemplate.boot,
    configInjectMethod: "csr1000v-vfat",
  },
};

const routerImage: ImageRecord = {
  id: "img-xrv",
  name: "xrv9k.qcow2",
  path: "/tmp/xrv9k.qcow2",
  format: "qcow2",
  sizeBytes: 1,
  updatedAt: "2026-01-01T00:00:00.000Z",
  templateId: "cisco-xrv9k",
  source: "upload",
  catalogState: "active",
};

describe("buildLabDocumentFromSpec", () => {
  const templates = [routerTemplate, hostTemplate, eosTemplate, asrTemplate];

  function build(specInput: {
    nodes: Array<{
      name: string;
      templateId: string;
      ramMb?: number;
      startupConfig?: string;
    }>;
    links: Array<{
      name?: string;
      members: Array<{ node: string; interfaceIndex?: number }>;
    }>;
    images?: ImageRecord[];
    accelerationMode?: string | null;
    allowedTemplateIds?: Array<string>;
  }) {
    return buildLabDocumentFromSpec({
      labId: "lab-test",
      spec: {
        name: "Test Lab",
        nodes: specInput.nodes.map((node) => ({ ...node })),
        links: specInput.links.map((link) => ({
          name: link.name,
          members: link.members.map((member) => ({ ...member })),
        })),
      },
      templates,
      images: specInput.images ?? [routerImage],
      accelerationMode: specInput.accelerationMode,
      allowedTemplateIds: specInput.allowedTemplateIds,
    });
  }

  it("builds a valid document from an exact-match spec", () => {
    const preview = build({
      nodes: [
        { name: "r1", templateId: "cisco-xrv9k" },
        { name: "r2", templateId: "cisco-xrv9k" },
        { name: "host1", templateId: "linux-ubuntu-container" },
      ],
      links: [
        {
          name: "r1-r2",
          members: [
            { node: "r1", interfaceIndex: 0 },
            { node: "r2", interfaceIndex: 0 },
          ],
        },
        {
          name: "lan-1",
          members: [
            { node: "r1", interfaceIndex: 1 },
            { node: "r2", interfaceIndex: 1 },
            { node: "host1" },
          ],
        },
      ],
    });

    expect(preview.document).not.toBeNull();
    const document = LabDocumentSchema.parse(preview.document);
    expect(document.nodes).toHaveLength(3);
    expect(document.networks).toHaveLength(2);
    expect(document.attachments).toHaveLength(5);

    const r1 = document.nodes.find((node) => node.name === "r1");
    expect(r1?.config.ramMb).toBe(4096);
    expect(r1?.config.nicModel).toBe("e1000");
    expect(r1?.interfaces.map((entry) => entry.slot)).toEqual([0, 1]);
    expect(r1?.interfaces[0]?.name).toBe("GigabitEthernet0/0/0/0");

    const host1 = document.nodes.find((node) => node.name === "host1");
    expect(host1?.config.containerImageRef).toBe("ubuntu:22.04");
    expect(host1?.imageId).toBeNull();

    // Router image resolved from the bound image record.
    expect(r1?.imageId).toBe("img-xrv");
    expect(preview.nodes.find((node) => node.name === "r1")?.imageBound).toBe(
      true,
    );
  });

  it("reports an issue and null document for unresolved templates", () => {
    const preview = build({
      nodes: [
        { name: "r1", templateId: "cisco-xrv9k" },
        { name: "mystery", templateId: "not-a-real-template" },
      ],
      links: [],
    });

    expect(preview.document).toBeNull();
    expect(preview.nodes.find((node) => node.name === "mystery")?.status).toBe(
      "unresolved",
    );
    expect(
      preview.issues.some((issue) =>
        issue.message.includes('No template for "not-a-real-template"'),
      ),
    ).toBe(true);
  });

  it("fuzzy-matches vendor shorthand hints", () => {
    // "eos" is aliased to arista-veos; "csr1000v" resolves via the shared
    // filename suggestion table.
    const preview = build({
      nodes: [
        { name: "sw1", templateId: "eos" },
        { name: "r1", templateId: "csr1000v" },
      ],
      links: [],
    });

    expect(preview.nodes.find((node) => node.name === "sw1")?.templateId).toBe(
      "arista-veos",
    );
    expect(preview.nodes.find((node) => node.name === "r1")?.templateId).toBe(
      "cisco-asr",
    );
    expect(
      preview.issues.filter((issue) => issue.severity === "info"),
    ).toHaveLength(2);
  });

  it("falls back to template defaults for out-of-range resources", () => {
    const preview = build({
      nodes: [
        { name: "r1", templateId: "cisco-xrv9k", ramMb: 999999 },
        { name: "host1", templateId: "linux-ubuntu-container" },
      ],
      links: [],
    });
    const document = LabDocumentSchema.parse(preview.document);
    expect(
      document.nodes.find((node) => node.name === "r1")?.config.ramMb,
    ).toBe(4096);
  });

  it("uses the host-detected acceleration for qemu nodes, not the template string", () => {
    const preview = build({
      nodes: [
        { name: "r1", templateId: "cisco-xrv9k" },
        { name: "host1", templateId: "linux-ubuntu-container" },
      ],
      links: [],
      accelerationMode: "kvm",
    });
    const document = LabDocumentSchema.parse(preview.document);
    expect(
      document.nodes.find((node) => node.name === "r1")?.config
        .accelerationMode,
    ).toBe("kvm");
    expect(
      document.nodes.find((node) => node.name === "host1")?.config
        .accelerationMode,
    ).toBe("none");
  });

  it("saves configs into an active set with inject-once boot actions", () => {
    const preview = build({
      nodes: [
        {
          name: "r1",
          templateId: "cisco-asr",
          startupConfig: "hostname r1\nenable secret cisco\nend\n",
        },
        { name: "host1", templateId: "linux-ubuntu-container" },
      ],
      links: [],
      accelerationMode: "kvm",
    });

    expect(preview.document).not.toBeNull();
    const document = LabDocumentSchema.parse(preview.document);
    expect(document.activeConfigSetId).toBe("cfg-ai-generated");
    expect(document.startupConfigSets[0]?.name).toBe("AI-generated configs");
    expect(document.startupConfigSets[0]?.nodeConfigs[0]?.nodeId).toBe(
      document.nodes.find((node) => node.name === "r1")?.id,
    );
    expect(document.nodeBootActions).toHaveLength(1);
    expect(document.nodeBootActions[0]).toMatchObject({
      startupConfig: "once",
    });

    const r1 = preview.nodes.find((node) => node.name === "r1");
    expect(r1?.configInjectMethod).toBe("csr1000v-vfat");
    expect(r1?.startupConfig).toContain("hostname r1");
  });

  it("warns but succeeds when a qemu template has no bound image", () => {
    const preview = build({
      nodes: [
        { name: "r1", templateId: "csr1000v" },
        { name: "mystery", templateId: "arista-veos" },
      ],
      links: [],
      allowedTemplateIds: ["cisco-xrv9k"],
    });

    expect(preview.nodes.find((node) => node.name === "r1")?.status).toBe(
      "unresolved",
    );
    expect(preview.nodes.find((node) => node.name === "mystery")?.status).toBe(
      "unresolved",
    );
    expect(preview.document).toBeNull();
    expect(
      preview.issues.some((issue) =>
        issue.message.includes("among the selected devices"),
      ),
    ).toBe(true);
  });

  it("warns but succeeds when a qemu template has no bound image", () => {
    const preview = build({
      nodes: [{ name: "r1", templateId: "cisco-xrv9k" }],
      links: [],
      images: [],
    });
    expect(preview.document).not.toBeNull();
    expect(
      preview.nodes.find((node) => node.name === "r1")?.imageId,
    ).toBeNull();
    expect(
      preview.issues.some((issue) => issue.message.includes("no bound image")),
    ).toBe(true);
  });

  it("warns and skips the config set when the template cannot inject", () => {
    const preview = build({
      nodes: [
        {
          name: "r1",
          templateId: "cisco-xrv9k",
          startupConfig: "hostname r1\n",
        },
      ],
      links: [],
    });

    expect(preview.document).not.toBeNull();
    const document = LabDocumentSchema.parse(preview.document);
    expect(document.startupConfigSets).toHaveLength(0);
    expect(document.activeConfigSetId).toBeNull();
    expect(document.nodeBootActions).toHaveLength(0);
    expect(
      preview.issues.some((issue) =>
        issue.message.includes("cannot inject a day-0 config"),
      ),
    ).toBe(true);
  });

  it("grows interfaceCount to cover claimed slots", () => {
    const preview = build({
      nodes: [{ name: "r1", templateId: "cisco-xrv9k" }],
      links: [
        {
          name: "p2p",
          members: [
            { node: "r1", interfaceIndex: 4 },
            { node: "r1", interfaceIndex: 3 },
          ],
        },
      ],
    });

    expect(preview.document).not.toBeNull();
    const document = LabDocumentSchema.parse(preview.document);
    const r1 = document.nodes.find((node) => node.name === "r1");
    expect(r1?.config.interfaceCount).toBe(5);
    expect(r1?.interfaces.map((entry) => entry.slot)).toEqual([0, 1, 2, 3, 4]);
    expect(document.attachments).toHaveLength(2);
  });

  it("reassigns colliding claimed slots and records the issue", () => {
    const preview = build({
      nodes: [{ name: "r1", templateId: "cisco-xrv9k" }],
      links: [
        {
          name: "a",
          members: [
            { node: "r1", interfaceIndex: 0 },
            { node: "r1", interfaceIndex: 0 },
          ],
        },
      ],
    });

    expect(
      preview.issues.some((issue) => issue.message.includes("already in use")),
    ).toBe(true);
    const document = LabDocumentSchema.parse(preview.document);
    expect(document.attachments).toHaveLength(2);
    const interfaceIds = new Set(
      document.attachments.map((attachment) => attachment.interfaceId),
    );
    expect(interfaceIds.size).toBe(2);
  });
});

describe("parseSpecJson", () => {
  it("extracts the JSON object from fenced or padded output", () => {
    const fenced = parseSpecJson(
      '```json\n{"name":"lab","nodes":[{"name":"r1","templateId":"cisco-xrv9k"}]}\n```',
    );
    expect(fenced.ok).toBe(true);

    const padded = parseSpecJson(
      'Sure, here is the lab: {"name":"lab","nodes":[{"name":"r1","templateId":"cisco-xrv9k"}]} hope this helps!',
    );
    expect(padded.ok).toBe(true);

    expect(extractJsonObject("no json here")).toBeNull();
  });

  it("rejects specs with duplicate node names or dangling link members", () => {
    const duplicates = parseSpecJson(
      '{"name":"lab","nodes":[{"name":"r1","templateId":"cisco-xrv9k"},{"name":"r1","templateId":"cisco-xrv9k"}]}',
    );
    expect(duplicates.ok).toBe(false);
    if (!duplicates.ok) {
      expect(duplicates.error).toContain("duplicate node name");
    }

    const dangling = parseSpecJson(
      '{"name":"lab","nodes":[{"name":"r1","templateId":"cisco-xrv9k"}],"links":[{"members":[{"node":"r1"},{"node":"ghost"}]}]}',
    );
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) {
      expect(dangling.error).toContain("unknown node");
    }
  });
});

describe("ai routes", () => {
  let tempDataDir = "";
  let app: App;
  let calls: Array<{ url: string; init?: RequestInit }>;
  let llmResponses: Array<{ status?: number; body: unknown }>;

  function fakeLlmFetcher(
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> {
    calls.push({ url: String(input), init });
    const response = llmResponses[calls.length - 1]!;
    return Promise.resolve(
      new Response(JSON.stringify(response.body), {
        status: response.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }

  const validSpec = {
    name: "AI Triangle Lab",
    nodes: [
      { name: "r1", templateId: "cisco-xrv9k", role: "core router" },
      { name: "r2", templateId: "cisco-xrv9k", role: "core router" },
      {
        name: "host1",
        templateId: "linux-ubuntu-container",
        role: "test host",
      },
    ],
    links: [
      {
        name: "r1-r2",
        members: [
          { node: "r1", interfaceIndex: 0 },
          { node: "r2", interfaceIndex: 0 },
        ],
      },
      {
        name: "lan-1",
        members: [
          { node: "r1", interfaceIndex: 1 },
          { node: "r2", interfaceIndex: 1 },
          { node: "host1" },
        ],
      },
    ],
  };

  beforeAll(async () => {
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-ai-"));
    process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
    calls = [];
    llmResponses = [];
    app = buildApp({ runtime: { fetcher: fakeLlmFetcher } });
  });

  afterAll(async () => {
    delete process.env.NETWORKCHUM_DATA_DIR;
    await app.close();
    await rm(tempDataDir, { recursive: true, force: true });
  });

  it("returns 400 when the provider is not configured", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/labs/preview",
      payload: { prompt: "build a triangle" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("LLM provider is not configured");
  });

  it("returns a null provider before configuration", async () => {
    const response = await app.inject({ method: "GET", url: "/ai/provider" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ provider: null });
  });

  it("allows a key-less self-hosted endpoint", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/ai/provider",
      payload: {
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:9999/v1",
        model: "test-model",
        apiKey: null,
      },
    });
    expect(response.statusCode).toBe(200);
  });

  it("requires a sign-in for a subscription provider without a credential", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/ai/provider",
      payload: {
        provider: "chatgpt",
        baseUrl: "https://chatgpt.com/backend-api/codex",
        model: "gpt-5.3-codex",
        apiKey: null,
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("saves settings and never echoes the raw key", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/ai/provider",
      payload: {
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:9999/v1",
        model: "test-model",
        apiKey: "sk-test-key-123",
      },
    });
    expect(response.statusCode).toBe(200);
    const view = response.json().provider;
    expect(view.hasApiKey).toBe(true);
    expect(view).not.toHaveProperty("apiKey");
    expect(JSON.stringify(response.json())).not.toContain("sk-test-key-123");

    const stored = JSON.parse(
      await readFile(path.join(tempDataDir, "ai-provider.json"), "utf8"),
    );
    expect(stored.apiKey).toBe("sk-test-key-123");
  });

  it("preserves the stored key when a save sends a null key", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/ai/provider",
      payload: {
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:9999/v1",
        model: "better-model",
        apiKey: null,
      },
    });
    expect(response.statusCode).toBe(200);
    const stored = JSON.parse(
      await readFile(path.join(tempDataDir, "ai-provider.json"), "utf8"),
    );
    expect(stored.apiKey).toBe("sk-test-key-123");
    expect(stored.model).toBe("better-model");
  });

  it("previews a generated lab through the openai-compatible flow", async () => {
    calls.length = 0;
    llmResponses = [
      {
        body: {
          choices: [{ message: { content: JSON.stringify(validSpec) } }],
        },
      },
    ];
    const response = await app.inject({
      method: "POST",
      url: "/ai/labs/preview",
      payload: { prompt: "triangle with a host" },
    });
    expect(response.statusCode).toBe(200);
    const { preview } = response.json() as { preview: AiLabPreview };
    expect(preview.labName).toBe("AI Triangle Lab");
    expect(preview.nodes).toHaveLength(3);
    expect(preview.nodes.every((node) => node.status === "matched")).toBe(true);
    expect(preview.links).toHaveLength(2);
    expect(preview.document).not.toBeNull();
    // The catalog is injected into the system prompt.
    expect(calls[0]?.init?.body).toContain("templateId: cisco-xrv9k");
  });

  it("repairs invalid model JSON with one additional round", async () => {
    calls.length = 0;
    llmResponses = [
      {
        body: {
          choices: [
            { message: { content: 'Here is your lab: {"name": oops}' } },
          ],
        },
      },
      {
        body: {
          choices: [{ message: { content: JSON.stringify(validSpec) } }],
        },
      },
    ];
    const response = await app.inject({
      method: "POST",
      url: "/ai/labs/preview",
      payload: { prompt: "triangle with a host" },
    });
    expect(response.statusCode).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.init?.body).toContain("was not a valid lab spec");
  });

  it("surfaces a 502 when both rounds produce invalid JSON", async () => {
    calls.length = 0;
    llmResponses = [
      { body: { choices: [{ message: { content: "not json" } }] } },
      { body: { choices: [{ message: { content: "still not json" } }] } },
    ];
    const response = await app.inject({
      method: "POST",
      url: "/ai/labs/preview",
      payload: { prompt: "triangle with a host" },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().message).toContain(
      "did not return a valid lab spec",
    );
  });

  it("creates the lab on commit and stores it", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/labs/commit",
      payload: { name: "AI Triangle Lab", spec: validSpec },
    });
    expect(response.statusCode).toBe(201);
    const { lab } = response.json();
    expect(lab.document.nodes).toHaveLength(3);
    expect(lab.document.attachments).toHaveLength(5);

    const fetched = await app.inject({
      method: "GET",
      url: `/labs/${lab.id}`,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().lab.document.nodes).toHaveLength(3);
  });

  it("rejects commits with unresolved templates", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/labs/commit",
      payload: {
        name: "Broken Lab",
        spec: {
          name: "Broken Lab",
          nodes: [{ name: "mystery", templateId: "not-a-real-template" }],
          links: [],
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("No template for");
  });

  it("detects models from an openai-compatible endpoint", async () => {
    calls.length = 0;
    llmResponses = [
      {
        body: {
          data: [
            { id: "zephyr-7b" },
            { id: "llama3:70b" },
            { id: "gpt-4o", display_name: "GPT-4o" },
          ],
        },
      },
    ];
    const response = await app.inject({
      method: "POST",
      url: "/ai/provider/probe",
      payload: {
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:9999/v1",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().models).toEqual([
      "gpt-4o",
      "llama3:70b",
      "zephyr-7b",
    ]);
    // Probe without a key in the payload used the stored key.
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-test-key-123");
  });

  it("falls back to /v1/models when /models 404s", async () => {
    calls.length = 0;
    llmResponses = [
      { status: 404, body: { error: "not found" } },
      { body: { data: [{ id: "llama3" }] } },
    ];
    const response = await app.inject({
      method: "POST",
      url: "/ai/provider/probe",
      payload: {
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:9999",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().models).toEqual(["llama3"]);
    expect(calls[0]?.url).toContain("/models");
    expect(calls[1]?.url).toContain("/v1/models");
  });

  it("probes the anthropic endpoint with its native path and headers", async () => {
    calls.length = 0;
    llmResponses = [{ body: { data: [{ id: "claude-sonnet-4-5" }] } }];
    const response = await app.inject({
      method: "POST",
      url: "/ai/provider/probe",
      payload: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.test",
        apiKey: "sk-anthropic-test",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().models).toEqual(["claude-sonnet-4-5"]);
    expect(calls[0]?.url).toContain("/v1/models");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("x-api-key")).toBe("sk-anthropic-test");
  });

  it("surfaces probe failures as 502", async () => {
    calls.length = 0;
    llmResponses = [{ status: 403, body: { error: "forbidden" } }];
    const response = await app.inject({
      method: "POST",
      url: "/ai/provider/probe",
      payload: {
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:9999/v1",
      },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().message).toContain("responded 403");
  });

  it("narrows the prompt and resolution to the selected devices", async () => {
    calls.length = 0;
    llmResponses = [
      {
        body: {
          choices: [{ message: { content: JSON.stringify(validSpec) } }],
        },
      },
    ];
    const response = await app.inject({
      method: "POST",
      url: "/ai/labs/preview",
      payload: {
        prompt: "the two csr routers from my device list",
        devices: ["cisco-xrv9k"],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0]?.init?.body).toContain(
      "Selected devices (hard constraint)",
    );
    expect(calls[0]?.init?.body).toContain("- cisco-xrv9k");
  });

  it("rejects commits that resolve outside the allowed device set", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/ai/labs/commit",
      payload: {
        name: "AI-lan",
        allowedTemplateIds: ["cisco-xrv9k"],
        spec: {
          name: "AI-lan",
          nodes: [{ name: "sw1", templateId: "arista-veos" }],
          links: [],
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("among the selected devices");
  });

  it("creates config sets and boot actions for generated configs", async () => {
    const spec = {
      name: "Cfg Lab",
      nodes: [
        {
          name: "r1",
          templateId: "cisco-asr",
          startupConfig: "hostname r1\nenable secret cisco\nend\n",
        },
      ],
      links: [],
    };
    calls.length = 0;
    llmResponses = [
      {
        body: { choices: [{ message: { content: JSON.stringify(spec) } }] },
      },
    ];
    const previewResponse = await app.inject({
      method: "POST",
      url: "/ai/labs/preview",
      payload: { prompt: "one configured router" },
    });
    expect(previewResponse.statusCode).toBe(200);
    const { preview } = previewResponse.json() as { preview: AiLabPreview };
    expect(preview.nodes[0]?.configInjectMethod).toBe("csr1000v-vfat");
    expect(preview.nodes[0]?.startupConfig).toContain("hostname r1");

    const commitResponse = await app.inject({
      method: "POST",
      url: "/ai/labs/commit",
      payload: { name: "Cfg Lab", spec },
    });
    expect(commitResponse.statusCode).toBe(201);
    const { lab } = commitResponse.json();
    expect(lab.document.activeConfigSetId).toBe("cfg-ai-generated");
    expect(lab.document.startupConfigSets[0]?.nodeConfigs).toHaveLength(1);
    expect(lab.document.nodeBootActions[0]).toMatchObject({
      startupConfig: "once",
    });
  });

  it("talks to the anthropic provider with native headers", async () => {
    const saved = await app.inject({
      method: "PUT",
      url: "/ai/provider",
      payload: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.test",
        model: "claude-test",
        apiKey: "sk-anthropic-test",
      },
    });
    expect(saved.statusCode).toBe(200);

    calls.length = 0;
    llmResponses = [
      {
        body: {
          content: [{ type: "text", text: JSON.stringify(validSpec) }],
        },
      },
    ];
    const response = await app.inject({
      method: "POST",
      url: "/ai/labs/preview",
      payload: { prompt: "triangle with a host" },
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0]?.url).toContain("/v1/messages");
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("x-api-key")).toBe("sk-anthropic-test");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.system).toContain("network engineer");
    expect(body.messages).toHaveLength(1);
  });
});

describe("ai routes auth", () => {
  let tempDataDir = "";
  let app: App;

  beforeAll(async () => {
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-ai-auth-"));
    process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
    process.env.NETWORKCHUM_API_TOKEN = "test-token-1234";
    app = buildApp();
  });

  afterAll(async () => {
    delete process.env.NETWORKCHUM_API_TOKEN;
    delete process.env.NETWORKCHUM_DATA_DIR;
    await app.close();
    await rm(tempDataDir, { recursive: true, force: true });
  });

  it("requires the token on all ai routes", async () => {
    const denied = await app.inject({ method: "GET", url: "/ai/provider" });
    expect(denied.statusCode).toBe(401);

    const deniedPut = await app.inject({
      method: "PUT",
      url: "/ai/provider",
      payload: {
        provider: "openai-compatible",
        baseUrl: "http://x/v1",
        model: "m",
        apiKey: "k",
      },
    });
    expect(deniedPut.statusCode).toBe(401);

    const deniedPreview = await app.inject({
      method: "POST",
      url: "/ai/labs/preview",
      payload: { prompt: "lab" },
    });
    expect(deniedPreview.statusCode).toBe(401);

    const deniedCommit = await app.inject({
      method: "POST",
      url: "/ai/labs/commit",
      payload: { name: "lab", spec: { name: "lab", nodes: [], links: [] } },
    });
    expect(deniedCommit.statusCode).toBe(401);

    const allowed = await app.inject({
      method: "GET",
      url: "/ai/provider",
      headers: { "x-networkchum-token": "test-token-1234" },
    });
    expect(allowed.statusCode).toBe(200);
  });
});
