import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./client.js";

describe("createApiClient", () => {
  it("maps catalog entries using template ids", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        entries: [
          {
            id: "entry-1",
            source: "image-bound",
            template: {
              id: "cisco-asr",
              displayName: "Cisco ASR",
              vendor: "Cisco",
              runtime: "qemu",
              configSchema: {
                ramMb: { default: 8192, min: 4096, max: 16384 },
                vcpu: { default: 4, min: 2, max: 8 },
                interfaceCount: { default: 8, min: 4, max: 24 },
              },
            },
          },
        ],
      }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);

    await expect(client.listCatalog()).resolves.toEqual([
      {
        id: "cisco-asr",
        name: "Cisco ASR",
        source: "image-bound",
        vendor: "Cisco",
        runtime: "qemu",
        configSchema: {
          ramMb: { default: 8192, min: 4096, max: 16384 },
          vcpu: { default: 4, min: 2, max: 8 },
          interfaceCount: { default: 8, min: 4, max: 24 },
        },
      },
    ]);
  });

  it("loads labs from the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ labs: [{ id: "lab-1", name: "Fetched Lab" }] }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const labs = await client.listLabs();

    expect(labs[0]?.name).toBe("Fetched Lab");
  });

  it("creates a lab through the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ lab: { id: "lab-2", name: "New Lab" } }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const lab = await client.createLab("New Lab");

    expect(fetcher).toHaveBeenCalledWith(
      "/api/labs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(lab.name).toBe("New Lab");
  });

  it("loads one lab document from the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        lab: {
          id: "lab-1",
          name: "Fetched Lab",
          document: { nodes: [], networks: [], attachments: [] },
        },
      }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const lab = await client.getLab("lab-1");

    expect(lab.id).toBe("lab-1");
    expect(fetcher).toHaveBeenCalledWith("/api/labs/lab-1");
  });

  it("adds a node through the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        lab: {
          id: "lab-1",
          name: "Fetched Lab",
          document: {
            nodes: [{ id: "node-1", name: "linux-vm-1" }],
            networks: [],
            attachments: [],
          },
        },
      }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const lab = await client.addNode("lab-1", {
      templateId: "cisco-iosv",
      name: "linux-vm-1",
      position: { x: 120, y: 90 },
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/labs/lab-1/nodes",
      expect.objectContaining({ method: "POST" }),
    );
    expect(lab.document.nodes[0]?.name).toBe("linux-vm-1");
  });

  it("powers on a node through the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        state: {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
        },
      }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const state = await client.powerOnNode("lab-1", "node-1");

    expect(fetcher).toHaveBeenCalledWith(
      "/api/labs/lab-1/nodes/node-1/power-on",
      expect.objectContaining({ method: "POST" }),
    );
    expect(state.status).toBe("running");
    expect(state.connectCommand?.[0]).toBe("docker");
  });

  it("uploads an image through the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        image: {
          id: "img-1",
          name: "csr1000v.qcow2",
          templateId: null,
          source: "upload",
          catalogState: "active",
        },
      }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const file = new File(["qcow2-data"], "csr1000v.qcow2", {
      type: "application/octet-stream",
    });
    const image = await client.uploadImage(file);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/images/upload",
      expect.objectContaining({ method: "POST" }),
    );
    expect(image.id).toBe("img-1");
  });

  it("deletes a lab through the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ labId: "lab-1" }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const result = await client.deleteLab("lab-1");

    expect(fetcher).toHaveBeenCalledWith(
      "/api/labs/lab-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result).toEqual({ labId: "lab-1" });
  });

  it("updates template defaults through the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        template: {
          id: "cisco-iosv",
          displayName: "Linux Generic VM",
          vendor: "Linux",
          runtime: "qemu",
          configSchema: {
            ramMb: { default: 4096, min: 1024, max: 16384 },
            vcpu: { default: 4, min: 1, max: 8 },
            interfaceCount: { default: 6, min: 1, max: 16 },
          },
        },
      }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const template = await client.updateTemplate("cisco-iosv", {
      vcpu: 4,
      ramMb: 4096,
      interfaceCount: 6,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/templates/cisco-iosv",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(template.configSchema.vcpu.default).toBe(4);
    expect(template.configSchema.ramMb.default).toBe(4096);
    expect(template.configSchema.interfaceCount.default).toBe(6);
  });
});
