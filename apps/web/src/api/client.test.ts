import { describe, expect, it, vi } from "vitest";

import {
  API_TOKEN_HEADER,
  createApiClient,
  setOnTokenRequired,
  setStoredApiToken,
} from "./client.js";

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
        imageId: null,
        imageName: null,
        configSchema: {
          ramMb: { default: 8192, min: 4096, max: 16384 },
          vcpu: { default: 4, min: 2, max: 8 },
          interfaceCount: { default: 8, min: 4, max: 24 },
        },
      },
    ]);
  });

  it("loads the full template registry from the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        templates: [
          {
            id: "cisco-iosv",
            displayName: "Cisco IOSv",
            vendor: "Cisco",
            runtime: "qemu",
            configSchema: {
              ramMb: { default: 2048, min: 1024, max: 8192 },
              vcpu: { default: 1, min: 1, max: 4 },
              interfaceCount: { default: 4, min: 1, max: 16 },
            },
          },
        ],
      }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);

    await expect(client.listTemplates()).resolves.toEqual([
      {
        id: "cisco-iosv",
        name: "Cisco IOSv",
        vendor: "Cisco",
        runtime: "qemu",
        configSchema: {
          ramMb: { default: 2048, min: 1024, max: 8192 },
          vcpu: { default: 1, min: 1, max: 4 },
          interfaceCount: { default: 4, min: 1, max: 16 },
        },
      },
    ]);
  });

  it("uploads a topology file for import preview", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        preview: {
          draftId: "draft-1",
          source: { format: "eve-unl", fileName: "demo.unl" },
          labName: "Demo",
          summary: { nodes: 0, networks: 0, links: 0 },
          nodes: [],
          issues: [],
        },
      }),
    }));
    const client = createApiClient(fetcher as unknown as typeof fetch);

    const preview = await client.previewTopologyImport(
      new File(["<lab />"], "demo.unl"),
    );

    expect(fetcher).toHaveBeenCalledWith("/api/imports/topology/preview", {
      method: "POST",
      body: expect.any(FormData),
    });
    expect(preview.draftId).toBe("draft-1");
  });

  it("commits a topology import draft", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        lab: {
          id: "lab-1",
          name: "Demo",
          document: { nodes: [], networks: [], attachments: [] },
        },
      }),
    }));
    const client = createApiClient(fetcher as unknown as typeof fetch);

    const lab = await client.commitTopologyImport("draft-1", {
      name: "Demo",
      mappings: [
        {
          templateKey: "qemu:vios:vios",
          templateId: "cisco-iosv",
          imageId: "img-1",
        },
      ],
      excludedNodeIds: ["2"],
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/imports/topology/draft-1/commit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Demo",
          mappings: [
            {
              templateKey: "qemu:vios:vios",
              templateId: "cisco-iosv",
              imageId: "img-1",
            },
          ],
          excludedNodeIds: ["2"],
        }),
      }),
    );
    expect(lab.id).toBe("lab-1");
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

  it("updates persistent canvas drawings through the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        lab: {
          id: "lab-1",
          name: "Fetched Lab",
          document: {
            canvas: {
              drawings: [
                {
                  id: "shape-1",
                  kind: "shape",
                  shape: "rectangle",
                  x: 20,
                  y: 30,
                  width: 180,
                  height: 90,
                  fill: "#fde68a",
                  stroke: "#f59e0b",
                  opacity: 0.35,
                  locked: false,
                  zIndex: 1,
                },
              ],
            },
            nodes: [],
            networks: [],
            attachments: [],
          },
        },
      }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const drawings = [
      {
        id: "shape-1",
        kind: "shape" as const,
        shape: "rectangle" as const,
        x: 20,
        y: 30,
        width: 180,
        height: 90,
        fill: "#fde68a",
        stroke: "#f59e0b",
        opacity: 0.35,
        locked: false,
        zIndex: 1,
      },
    ];

    const lab = await client.updateCanvasDrawings("lab-1", drawings);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/labs/lab-1/canvas/drawings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ drawings }),
      }),
    );
    expect(lab.document.canvas?.drawings).toEqual(drawings);
  });

  it("moves multiple nodes through the backend in one request", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        lab: {
          id: "lab-1",
          name: "Fetched Lab",
          document: {
            nodes: [
              { id: "node-a", position: { x: 42, y: 99 } },
              { id: "node-b", position: { x: 80, y: 120 } },
            ],
            networks: [],
            attachments: [],
          },
        },
      }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const moves = [
      { nodeId: "node-a", position: { x: 42, y: 99 } },
      { nodeId: "node-b", position: { x: 80, y: 120 } },
    ];

    const lab = await client.moveNodes("lab-1", moves);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/labs/lab-1/nodes/positions",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ moves }),
      }),
    );
    expect(lab.document.nodes).toHaveLength(2);
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

  it("adds and browses an image repo through the backend", async () => {
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/image-repos" && init?.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            repo: {
              id: "repo-labhub",
              name: "LabHub qemu",
              kind: "url",
              path: null,
              url: "https://labhub.eu.org/0:/addons/qemu/",
              addedAt: "2026-10-21T00:00:00.000Z",
            },
          }),
        };
      }
      if (url === "/api/image-repos/repo-labhub/entries?path=%2Flinux-min") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            repoId: "repo-labhub",
            path: "/linux-min",
            folders: [],
            files: [
              {
                name: "virtioa.qcow2",
                path: "/linux-min/virtioa.qcow2",
                kind: "file",
                url: null,
                sizeBytes: 10,
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const repo = await client.addImageRepo({
      name: "LabHub qemu",
      kind: "url",
      url: "https://labhub.eu.org/0:/addons/qemu/",
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/image-repos",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "LabHub qemu",
          kind: "url",
          url: "https://labhub.eu.org/0:/addons/qemu/",
        }),
      }),
    );
    expect(repo.id).toBe("repo-labhub");

    const listing = await client.listRepoEntries("repo-labhub", "/linux-min");
    expect(listing.files).toEqual([
      expect.objectContaining({ name: "virtioa.qcow2" }),
    ]);
  });

  it("starts and polls a repo pull through the backend", async () => {
    const fetcher = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/image-repos/repo-1/pulls" && init?.method === "POST") {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            pull: {
              id: "pull-1",
              repoId: "repo-1",
              entryPath: "/linux-min",
              status: "running",
              startedAt: "2026-10-21T00:00:00.000Z",
              finishedAt: null,
              currentFile: null,
              bytesReceived: null,
              images: [],
              warnings: [],
              error: null,
            },
          }),
        };
      }
      if (url === "/api/image-repos/repo-1/pulls") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            pulls: [
              {
                id: "pull-1",
                repoId: "repo-1",
                entryPath: "/linux-min",
                status: "done",
                startedAt: "2026-10-21T00:00:00.000Z",
                finishedAt: "2026-10-21T00:01:00.000Z",
                currentFile: null,
                bytesReceived: 1234,
                images: ["img-1"],
                warnings: [],
                error: null,
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const pull = await client.startRepoPull("repo-1", "/linux-min");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/image-repos/repo-1/pulls",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ entryPath: "/linux-min" }),
      }),
    );
    expect(pull.status).toBe("running");

    const pulls = await client.listRepoPulls("repo-1");
    expect(pulls).toEqual([
      expect.objectContaining({ status: "done", images: ["img-1"] }),
    ]);
  });

  it("surfaces the backend error message when adding a repo fails", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ message: "Path is not a directory: /nope" }),
    }));
    const client = createApiClient(fetcher as unknown as typeof fetch);

    await expect(
      client.addImageRepo({ name: "Bad", kind: "local", path: "/nope" }),
    ).rejects.toThrow("Path is not a directory: /nope");
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

  it("renames a node through the backend", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        lab: {
          id: "lab-1",
          name: "Fetched Lab",
          document: {
            nodes: [{ id: "node-1", name: "edge-1" }],
            networks: [],
            attachments: [],
          },
        },
      }),
    }));

    const client = createApiClient(fetcher as unknown as typeof fetch);
    const lab = await client.renameNode("lab-1", "node-1", "edge-1");

    expect(fetcher).toHaveBeenCalledWith(
      "/api/labs/lab-1/nodes/node-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "edge-1" }),
      }),
    );
    expect(lab.document.nodes[0]?.name).toBe("edge-1");
  });

  it("attaches the stored API token to requests", async () => {
    setStoredApiToken("secret-token");
    const fetcher = vi.fn(
      async (_input: unknown, init?: { headers?: HeadersInit }) => ({
        ok: true,
        json: async () => ({}),
      }),
    );
    const client = createApiClient(fetcher as unknown as typeof fetch);

    await client.listLabs();

    expect(fetcher).toHaveBeenCalledWith(
      "/api/labs",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const init = fetcher.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get(API_TOKEN_HEADER)).toBe(
      "secret-token",
    );
    setStoredApiToken("");
  });

  it("notifies the token-required handler on 401 responses", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: "Unauthorized: API token required" }),
    }));
    const client = createApiClient(fetcher as unknown as typeof fetch);
    const onTokenRequired = vi.fn();
    const dispose = setOnTokenRequired(onTokenRequired);

    await expect(client.listLabs()).rejects.toThrow();
    expect(onTokenRequired).toHaveBeenCalledTimes(1);
    dispose();
  });
});
