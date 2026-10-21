import { describe, expect, it } from "vitest";
import type {
  AiProviderSettings,
  ImageRecord,
  Template,
} from "@networkchum/shared";

import { classifyImages } from "./classifyImages.js";

const settings: AiProviderSettings = {
  provider: "openai-compatible",
  baseUrl: "https://llm.test/v1",
  model: "test-model",
  apiKey: "test-key",
};

function template(
  id: string,
  overrides: {
    ramMb?: { default?: number; min?: number; max?: number };
    vcpu?: { default?: number; min?: number; max?: number };
    interfaceCount?: { default?: number; min?: number; max?: number };
  } = {},
): Template {
  return {
    id,
    runtime: "qemu",
    displayName: id,
    vendor: "Test",
    deviceRoleIcon: "router",
    boot: {
      console: "serial",
      acceleration: "hardware",
    },
    configSchema: {
      ramMb: { default: 2048, min: 512, max: 8192, ...overrides.ramMb },
      vcpu: { default: 1, min: 1, max: 4, ...overrides.vcpu },
      interfaceCount: {
        default: 4,
        min: 1,
        max: 16,
        ...overrides.interfaceCount,
      },
    },
  };
}

function image(id: string, name: string): ImageRecord {
  return {
    id,
    name,
    path: `/data/${name}`,
    format: "qcow2",
    sizeBytes: 2 * 1024 * 1024 * 1024,
    updatedAt: new Date().toISOString(),
    templateId: null,
    suggestedTemplateId: null,
    source: "pull",
    catalogState: "active",
  };
}

function llmResponse(content: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }),
      { status: 200 },
    )) as typeof fetch;
}

const templates = [
  template("cisco-iosv", { ramMb: { min: 256, max: 1024 } }),
  template("juniper-vrr"),
  template("generic-vm"),
];

describe("classifyImages", () => {
  it("maps images to templates and clamps hardware into bounds", async () => {
    const fetcher = llmResponse({
      classifications: [
        { imageId: "img-1", templateId: "juniper-vrr", ramMb: 16384, vcpu: 8 },
        {
          imageId: "img-2",
          templateId: "cisco-iosv",
          ramMb: 64,
          vcpu: 1,
          reason: "IOSv",
        },
      ],
    });

    const results = await classifyImages({
      settings,
      images: [
        image("img-1", "vJunosEvolved-24.2R1.qcow2"),
        image("img-2", "iosv.qcow2"),
      ],
      templates,
      fetcher,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      imageId: "img-1",
      templateId: "juniper-vrr",
      ramMb: 8192,
      vcpu: 4,
    });
    expect(results[1]).toMatchObject({
      imageId: "img-2",
      templateId: "cisco-iosv",
      ramMb: 256,
      vcpu: 1,
      reason: "IOSv",
    });
  });

  it("drops classifications for unknown images or templates", async () => {
    const fetcher = llmResponse({
      classifications: [
        { imageId: "img-unknown", templateId: "juniper-vrr", ramMb: 2048 },
        { imageId: "img-1", templateId: "not-a-template", ramMb: 2048 },
        { imageId: "img-1", templateId: "generic-vm", ramMb: 2048, vcpu: 1 },
      ],
    });

    const results = await classifyImages({
      settings,
      images: [image("img-1", "mystery.qcow2")],
      templates,
      fetcher,
    });

    expect(results).toEqual([
      {
        imageId: "img-1",
        templateId: "generic-vm",
        ramMb: 2048,
        vcpu: 1,
        reason: null,
      },
    ]);
  });

  it("keeps a deterministic vendor match when the model suggests generic-vm", async () => {
    const fetcher = llmResponse({
      classifications: [
        { imageId: "img-1", templateId: "generic-vm", ramMb: 2048, vcpu: 1 },
      ],
    });

    const results = await classifyImages({
      settings,
      images: [
        {
          ...image("img-1", "csr1000v-16.3.qcow2"),
          suggestedTemplateId: "cisco-iosv",
        },
      ],
      templates,
      fetcher,
    });

    // Vendor guess kept, hardware re-clamped into that template's bounds.
    expect(results).toEqual([
      {
        imageId: "img-1",
        templateId: "cisco-iosv",
        ramMb: 1024,
        vcpu: 1,
        reason: null,
      },
    ]);
  });

  it("fails with a clear message when the model returns no JSON", async () => {
    const fetcher = llmResponse("I cannot help with that");

    await expect(
      classifyImages({
        settings,
        images: [image("img-1", "mystery.qcow2")],
        templates,
        fetcher,
      }),
    ).rejects.toThrow(/no JSON object found/);
  });
});
