import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ImageRecord } from "@networkchum/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { saveImages } from "../images/imageStore.js";

type App = ReturnType<typeof buildApp>;

let tempDataDir = "";

function llmFetcher(content: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(content) } }],
      }),
      { status: 200 },
    )) as typeof fetch;
}

function testImage(
  id: string,
  name: string,
  overrides: Partial<ImageRecord> = {},
): ImageRecord {
  return {
    id,
    name,
    path: path.join(tempDataDir, "images", name),
    format: "qcow2",
    sizeBytes: 2 * 1024 * 1024 * 1024,
    updatedAt: new Date().toISOString(),
    templateId: null,
    suggestedTemplateId: null,
    source: "pull",
    catalogState: "active",
    ...overrides,
  };
}

beforeAll(() => {
  tempDataDir = mkdtempSync(path.join(os.tmpdir(), "networkchum-classify-"));
  process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
});

afterAll(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
  }
});

describe("POST /ai/images/classify", () => {
  it("rejects requests when no LLM provider is configured", async () => {
    const app = buildApp();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/ai/images/classify",
        payload: { imageIds: ["img-1"] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain(
        "LLM provider is not configured",
      );
    } finally {
      await app.close();
    }
  });

  it("classifies, auto-binds unbound images, records AI hardware, and uses it for new nodes", async () => {
    await saveImages([
      testImage("img-unbound", "vJunosEvolved-24.2R1.qcow2"),
      // Manually bound: the AI suggestion must not clobber this binding.
      testImage("img-manual", "mystery-box.qcow2", {
        templateId: "generic-vm",
        suggestedTemplateId: null,
      }),
    ]);

    const settingsApp = buildApp();
    try {
      const saved = await settingsApp.inject({
        method: "PUT",
        url: "/ai/provider",
        payload: {
          provider: "openai-compatible",
          baseUrl: "https://llm.test/v1",
          model: "test-model",
          apiKey: "test-key",
        },
      });
      expect(saved.statusCode).toBe(200);
    } finally {
      await settingsApp.close();
    }

    const classifyApp = buildApp({
      runtime: {
        fetcher: llmFetcher({
          classifications: [
            {
              imageId: "img-unbound",
              templateId: "juniper-vrr",
              ramMb: 16384,
              vcpu: 8,
              reason: "Junos Evolved router",
            },
            { imageId: "img-manual", templateId: "generic-vm", ramMb: 2048 },
          ],
        }),
      },
    });
    try {
      const response = await classifyApp.inject({
        method: "POST",
        url: "/ai/images/classify",
        payload: { imageIds: ["img-unbound", "img-manual"] },
      });
      expect(response.statusCode).toBe(200);

      const images = response.json().images as Array<
        ImageRecord & { suggestedSource?: string | null }
      >;
      const unbound = images.find((image) => image.id === "img-unbound");
      const manual = images.find((image) => image.id === "img-manual");
      expect(unbound).toMatchObject({
        templateId: "juniper-vrr",
        suggestedTemplateId: "juniper-vrr",
        suggestedRamMb: 8192,
        suggestedVcpu: 4,
        suggestedReason: "Junos Evolved router",
        suggestedSource: "ai",
      });
      // Manual binding preserved; suggestion still recorded.
      expect(manual).toMatchObject({
        templateId: "generic-vm",
        suggestedTemplateId: "generic-vm",
        suggestedSource: "ai",
      });
    } finally {
      await classifyApp.close();
    }

    // New nodes for the classified image adopt the AI hardware, clamped into
    // the template's bounds (juniper-vrr: ram max 8192, vcpu max 4).
    const nodeApp = buildApp({
      runtime: {
        runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
        hasBinary: async () => false,
      },
    });
    try {
      const labResponse = await nodeApp.inject({
        method: "POST",
        url: "/labs",
        payload: { name: "AI Classify Lab" },
      });
      expect(labResponse.statusCode).toBe(201);
      const labId = (labResponse.json() as { lab: { id: string } }).lab.id;

      const nodeResponse = await nodeApp.inject({
        method: "POST",
        url: `/labs/${labId}/nodes`,
        payload: {
          templateId: "juniper-vrr",
          name: "evo-1",
          position: { x: 10, y: 10 },
          imageId: "img-unbound",
        },
      });
      expect(nodeResponse.statusCode).toBe(201);
      const node = (
        nodeResponse.json() as {
          lab: {
            document: {
              nodes: Array<{ config: { ramMb: number; vcpu: number } }>;
            };
          };
        }
      ).lab.document.nodes[0];
      expect(node?.config.ramMb).toBe(8192);
      expect(node?.config.vcpu).toBe(4);
    } finally {
      await nodeApp.close();
    }
  });
});
