import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { NodeBootAction, NodeBootActionState } from "@networkchum/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DeviceRoleIcon } from "./templates/deviceRoleIcon.js";
import { appendRunningConfigBackupRecord } from "./runtime/runningConfigBackupStore.js";
import { buildApp } from "./app.js";
import { saveImages } from "./images/imageStore.js";
import { getLab } from "./labs/labStore.js";
import {
  listRuntimeStates,
  upsertRuntimeState,
} from "./runtime/runtimeStateStore.js";
import { getCloudManagementCapability } from "./runtime/hostCapabilities.js";

type App = ReturnType<typeof buildApp>;

let tempDataDir = "";
let app: App;

async function createLabWithNode(nodeName: string) {
  const createLabResponse = await app.inject({
    method: "POST",
    url: "/labs",
    payload: { name: `${nodeName} Lab` },
  });
  const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

  const addNodeResponse = await app.inject({
    method: "POST",
    url: `/labs/${labId}/nodes`,
    payload: {
      templateId: "linux-alpine-container",
      name: nodeName,
      position: { x: 10, y: 10 },
    },
  });
  expect(addNodeResponse.statusCode).toBe(201);
  const nodeId = (
    addNodeResponse.json() as {
      lab: { document: { nodes: Array<{ id: string }> } };
    }
  ).lab.document.nodes[0]?.id;
  if (!nodeId) {
    throw new Error("Missing node id");
  }

  return { labId, nodeId };
}

async function patchBootAction(
  labId: string,
  nodeId: string,
  actions: {
    startupConfig: NodeBootAction;
    runningConfigBackup: NodeBootAction;
  },
) {
  const response = await app.inject({
    method: "PATCH",
    url: `/labs/${labId}/nodes/${nodeId}/boot-action`,
    payload: actions,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    lab: {
      document: {
        nodeBootActions: NodeBootActionState[];
      };
    };
  };
}

beforeAll(async () => {
  tempDataDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-api-tests-"));
  process.env.NETWORKCHUM_DATA_DIR = tempDataDir;

  app = buildApp({
    runtime: {
      runCommand: async (command, args) => {
        if (command === "docker" && args[0] === "run") {
          return { ok: true, stdout: "container-id-from-test", stderr: "" };
        }
        if (command === "docker" && args[0] === "inspect") {
          return { ok: true, stdout: "true", stderr: "" };
        }
        if (command === "docker" && args[0] === "image" && args[1] === "ls") {
          return {
            ok: true,
            stdout: [
              JSON.stringify({
                Repository: "docker.io/library/alpine",
                Tag: "latest",
                ID: "sha256:alpine123",
                Size: "7MB",
              }),
            ].join("\n"),
            stderr: "",
          };
        }
        if (command === "docker" && args[0] === "pull") {
          return { ok: true, stdout: "pulled", stderr: "" };
        }

        return { ok: true, stdout: "", stderr: "" };
      },
      hasBinary: async (command) => command === "docker",
      isBridgeInterface: async (interfaceName) =>
        interfaceName === "br-mgmt" || interfaceName === "br-lab",
      listHostInterfaces: async () => ["br-lab", "br-mgmt"],
    },
  });
});

afterAll(async () => {
  await app.close();
  delete process.env.NETWORKCHUM_DATA_DIR;
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
  }
});

describe("api", () => {
  it("returns 200 from health endpoint", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      ok: boolean;
      capabilities: {
        cloudManagement: ReturnType<typeof getCloudManagementCapability>;
      };
    };
    expect(payload).toEqual({
      ok: true,
      capabilities: {
        cloudManagement: getCloudManagementCapability(),
      },
    });
  });

  it("allows browser preflights for mutating lab requests", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/labs/lab-1/nodes/positions",
      headers: {
        origin: "http://192.168.2.57:5173",
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://192.168.2.57:5173",
    );
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("previews an uploaded EVE lab import", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/imports/topology/preview",
      headers: {
        "content-type": "multipart/form-data; boundary=----test",
      },
      payload:
        "------test\r\n" +
        'Content-Disposition: form-data; name="file"; filename="demo.unl"\r\n' +
        "Content-Type: application/xml\r\n\r\n" +
        '<lab name="Demo"><topology><nodes /></topology></lab>\r\n' +
        "------test--\r\n",
    });

    expect(response.statusCode).toBe(200);
    expect(
      (response.json() as { preview: { labName: string } }).preview.labName,
    ).toBe("Demo");
  });

  it("commits a resolved import draft as a lab", async () => {
    const previewResponse = await app.inject({
      method: "POST",
      url: "/imports/topology/preview",
      headers: { "content-type": "multipart/form-data; boundary=----test" },
      payload:
        "------test\r\n" +
        'Content-Disposition: form-data; name="file"; filename="demo.unl"\r\n' +
        "Content-Type: application/xml\r\n\r\n" +
        '<lab name="Demo"><topology><nodes /></topology></lab>\r\n' +
        "------test--\r\n",
    });
    const draftId = (previewResponse.json() as { preview: { draftId: string } })
      .preview.draftId;

    const commitResponse = await app.inject({
      method: "POST",
      url: `/imports/topology/${draftId}/commit`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ name: "Imported Demo", mappings: [] }),
    });

    expect(commitResponse.statusCode).toBe(201);
    expect((commitResponse.json() as { lab: { name: string } }).lab.name).toBe(
      "Imported Demo",
    );
  });

  it("commits imported cabling into lab networks and attachments", async () => {
    const previewResponse = await app.inject({
      method: "POST",
      url: "/imports/topology/preview",
      headers: { "content-type": "multipart/form-data; boundary=----test" },
      payload:
        "------test\r\n" +
        'Content-Disposition: form-data; name="file"; filename="demo.unl"\r\n' +
        "Content-Type: application/xml\r\n\r\n" +
        '<lab name="Demo"><topology><nodes>' +
        '<node id="1" name="R1" type="qemu" template="linux" image="alpine" ethernet="1"><interfaces><interface id="0" name="eth0" network_id="1" /></interfaces></node>' +
        '<node id="2" name="R2" type="qemu" template="linux" image="alpine" ethernet="1"><interfaces><interface id="0" name="eth0" network_id="1" /></interfaces></node>' +
        '</nodes><networks><network id="1" name="lan1" /></networks></topology></lab>\r\n' +
        "------test--\r\n",
    });
    const draftId = (previewResponse.json() as { preview: { draftId: string } })
      .preview.draftId;

    const commitResponse = await app.inject({
      method: "POST",
      url: `/imports/topology/${draftId}/commit`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        name: "Imported Demo",
        mappings: [
          {
            templateKey: "qemu:linux:alpine",
            templateId: "linux-alpine-container",
          },
        ],
      }),
    });

    const payload = commitResponse.json() as {
      lab: { document: { networks: unknown[]; attachments: unknown[] } };
    };
    expect(commitResponse.statusCode).toBe(201);
    expect(payload.lab.document.networks).toHaveLength(1);
    expect(payload.lab.document.attachments).toHaveLength(2);
  });

  it("commits an import draft without excluded unresolved nodes", async () => {
    const previewResponse = await app.inject({
      method: "POST",
      url: "/imports/topology/preview",
      headers: { "content-type": "multipart/form-data; boundary=----test" },
      payload:
        "------test\r\n" +
        'Content-Disposition: form-data; name="file"; filename="demo.unl"\r\n' +
        "Content-Type: application/xml\r\n\r\n" +
        '<lab name="Demo"><topology><nodes>' +
        '<node id="1" name="Mystery" type="qemu" template="mystery" image="missing" ethernet="1" />' +
        "</nodes></topology></lab>\r\n" +
        "------test--\r\n",
    });
    const draftId = (previewResponse.json() as { preview: { draftId: string } })
      .preview.draftId;

    const commitResponse = await app.inject({
      method: "POST",
      url: `/imports/topology/${draftId}/commit`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        name: "Imported Demo",
        mappings: [],
        excludedNodeIds: ["1"],
      }),
    });

    expect(commitResponse.statusCode).toBe(201);
    expect(
      (commitResponse.json() as { lab: { document: { nodes: unknown[] } } }).lab
        .document.nodes,
    ).toHaveLength(0);
  });

  it("returns built-in templates", async () => {
    const response = await app.inject({ method: "GET", url: "/templates" });
    const payload = response.json() as {
      templates: Array<{
        id: string;
        configSchema?: {
          ramMb: { default: number };
          vcpu: { default: number };
        };
      }>;
    };
    expect(
      payload.templates.some((template) => template.id === "cisco-asr"),
    ).toBe(true);
  });

  it("reports the detected container runtime and local images", async () => {
    const runtimeResponse = await app.inject({
      method: "GET",
      url: "/containers/runtime",
    });
    expect(runtimeResponse.statusCode).toBe(200);
    expect(runtimeResponse.json()).toEqual({
      engine: "docker",
      available: true,
      message: null,
    });

    const imagesResponse = await app.inject({
      method: "GET",
      url: "/containers/images",
    });
    expect(imagesResponse.statusCode).toBe(200);
    expect(imagesResponse.json()).toEqual({
      engine: "docker",
      images: [
        {
          id: "sha256:alpine123",
          imageRef: "docker.io/library/alpine:latest",
          repository: "docker.io/library/alpine",
          tag: "latest",
          size: "7MB",
        },
      ],
      message: null,
    });
  });

  it("searches Docker Hub for container images", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              repo_name: "library/oraclelinux",
              short_description: "Oracle Linux base image",
              star_count: 42,
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )) as typeof fetch;

    try {
      const response = await app.inject({
        method: "GET",
        url: "/containers/search?registry=docker-hub&query=oraclelinux%3A9-slim",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        registry: "docker-hub",
        results: [
          {
            registry: "docker-hub",
            imageRef: "library/oraclelinux:9-slim",
            repository: "library/oraclelinux",
            description: "Oracle Linux base image",
            stars: 42,
          },
        ],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("pulls a container image and saves a reusable template", async () => {
    const pullResponse = await app.inject({
      method: "POST",
      url: "/containers/pull",
      payload: {
        registry: "docker-hub",
        imageRef: "oraclelinux:9-slim",
      },
    });

    expect(pullResponse.statusCode).toBe(200);
    expect(pullResponse.json()).toEqual({
      engine: "docker",
      imageRef: "oraclelinux:9-slim",
      image: null,
    });

    const saveResponse = await app.inject({
      method: "POST",
      url: "/containers/templates",
      payload: {
        displayName: "Oracle Linux 9",
        imageRef: "oraclelinux:9-slim",
        registry: "docker-hub",
        shell: "sh",
      },
    });

    expect(saveResponse.statusCode).toBe(201);
    expect(saveResponse.json()).toEqual({
      template: expect.objectContaining({
        id: "user-container-oracle-linux-9",
        runtime: "container",
        displayName: "Oracle Linux 9",
        vendor: "Oraclelinux",
        container: expect.objectContaining({
          imageRef: "oraclelinux:9-slim",
          registry: "docker-hub",
          engine: "docker",
          defaultShell: "sh",
        }),
      }),
    });

    const catalogResponse = await app.inject({
      method: "GET",
      url: "/catalog",
    });
    expect(catalogResponse.statusCode).toBe(200);
    expect(catalogResponse.json()).toEqual({
      entries: expect.arrayContaining([
        expect.objectContaining({
          template: expect.objectContaining({
            id: "user-container-oracle-linux-9",
            displayName: "Oracle Linux 9",
            runtime: "container",
          }),
        }),
      ]),
    });
  });

  it("returns Arista vEOS with reduced CPU but full memory for emulated hosts", async () => {
    const response = await app.inject({ method: "GET", url: "/templates" });
    const payload = response.json() as {
      templates: Array<{
        id: string;
        configSchema: { ramMb: { default: number }; vcpu: { default: number } };
      }>;
    };

    const arista = payload.templates.find(
      (template) => template.id === "arista-veos",
    );

    expect(arista?.configSchema.vcpu.default).toBe(1);
    expect(arista?.configSchema.ramMb.default).toBe(4096);
  });

  it("updates template defaults and applies them to future nodes", async () => {
    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/templates/linux-ubuntu-container",
      payload: {
        vcpu: 2,
        ramMb: 1024,
        interfaceCount: 3,
        deviceRoleIcon: "firewall",
      },
    });

    expect(patchResponse.statusCode).toBe(200);

    const templatesResponse = await app.inject({
      method: "GET",
      url: "/templates",
    });
    const templatesPayload = templatesResponse.json() as {
      templates: Array<{
        id: string;
        deviceRoleIcon?: DeviceRoleIcon;
        configSchema: {
          ramMb: { default: number };
          vcpu: { default: number };
          interfaceCount: { default: number };
        };
      }>;
    };
    const updatedTemplate = templatesPayload.templates.find(
      (template) => template.id === "linux-ubuntu-container",
    );

    expect(updatedTemplate?.configSchema.vcpu.default).toBe(2);
    expect(updatedTemplate?.configSchema.ramMb.default).toBe(1024);
    expect(updatedTemplate?.configSchema.interfaceCount.default).toBe(3);
    expect(updatedTemplate?.deviceRoleIcon).toBe("firewall");

    const catalogResponse = await app.inject({
      method: "GET",
      url: "/catalog",
    });
    const catalogPayload = catalogResponse.json() as {
      entries: Array<{
        template: {
          id: string;
          configSchema: {
            ramMb: { default: number };
            vcpu: { default: number };
            interfaceCount: { default: number };
          };
        };
      }>;
    };
    const updatedCatalogTemplate = catalogPayload.entries.find(
      (entry) => entry.template.id === "linux-ubuntu-container",
    );

    expect(updatedCatalogTemplate?.template.configSchema.vcpu.default).toBe(2);
    expect(updatedCatalogTemplate?.template.configSchema.ramMb.default).toBe(
      1024,
    );
    expect(
      updatedCatalogTemplate?.template.configSchema.interfaceCount.default,
    ).toBe(3);

    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Template Override Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "linux-ubuntu-container",
        name: "ubuntu-1",
        position: { x: 10, y: 10 },
      },
    });

    expect(addNodeResponse.statusCode).toBe(201);
    const addNodePayload = addNodeResponse.json() as {
      lab: {
        document: {
          nodes: Array<{
            config: { vcpu: number; ramMb: number; interfaceCount: number };
            interfaces: Array<unknown>;
          }>;
        };
      };
    };

    expect(addNodePayload.lab.document.nodes[0]?.config.vcpu).toBe(2);
    expect(addNodePayload.lab.document.nodes[0]?.config.ramMb).toBe(1024);
    expect(addNodePayload.lab.document.nodes[0]?.config.interfaceCount).toBe(3);
    expect(addNodePayload.lab.document.nodes[0]?.interfaces).toHaveLength(3);
  });

  it("supports partial template updates driven by deviceRoleIcon", async () => {
    const templatesBeforeResponse = await app.inject({
      method: "GET",
      url: "/templates",
    });
    const templatesBeforePayload = templatesBeforeResponse.json() as {
      templates: Array<{
        id: string;
        deviceRoleIcon?: DeviceRoleIcon;
        configSchema: {
          ramMb: { default: number };
          vcpu: { default: number };
          interfaceCount: { default: number };
        };
      }>;
    };
    const beforeTemplate = templatesBeforePayload.templates.find(
      (template) => template.id === "linux-ubuntu-container",
    );

    expect(beforeTemplate).toBeTruthy();

    const patchResponse = await app.inject({
      method: "PATCH",
      url: "/templates/linux-ubuntu-container",
      payload: {
        deviceRoleIcon: "switch",
      },
    });

    expect(patchResponse.statusCode).toBe(200);

    const templatesAfterResponse = await app.inject({
      method: "GET",
      url: "/templates",
    });
    const templatesAfterPayload = templatesAfterResponse.json() as {
      templates: Array<{
        id: string;
        deviceRoleIcon?: DeviceRoleIcon;
        configSchema: {
          ramMb: { default: number };
          vcpu: { default: number };
          interfaceCount: { default: number };
        };
      }>;
    };
    const afterTemplate = templatesAfterPayload.templates.find(
      (template) => template.id === "linux-ubuntu-container",
    );

    expect(afterTemplate).toBeTruthy();
    expect(afterTemplate?.deviceRoleIcon).toBe("switch");
    expect(afterTemplate?.configSchema).toEqual(beforeTemplate?.configSchema);
  });

  it("rejects invalid deviceRoleIcon values", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/templates/linux-ubuntu-container",
      payload: {
        deviceRoleIcon: "not-a-real-role",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("creates and lists labs", async () => {
    const createResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Core Lab" },
    });

    expect(createResponse.statusCode).toBe(201);

    const listResponse = await app.inject({ method: "GET", url: "/labs" });
    const payload = listResponse.json() as { labs: Array<{ name: string }> };

    expect(payload.labs.some((lab) => lab.name === "Core Lab")).toBe(true);
  });

  it("adds a node to a lab topology", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Mutation Lab" },
    });
    const createdLab = createLabResponse.json() as { lab: { id: string } };

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${createdLab.lab.id}/nodes`,
      payload: {
        templateId: "cisco-iosv",
        name: "host-1",
        position: { x: 120, y: 80 },
      },
    });

    expect(addNodeResponse.statusCode).toBe(201);

    const getLabResponse = await app.inject({
      method: "GET",
      url: `/labs/${createdLab.lab.id}`,
    });
    const payload = getLabResponse.json() as {
      lab: { document: { nodes: Array<{ name: string }> } };
    };

    expect(payload.lab.document.nodes).toHaveLength(1);
    expect(payload.lab.document.nodes[0]?.name).toBe("host-1");
  });

  it("persists canvas drawings on the lab document", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Drawing Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const drawings = [
      {
        id: "building-a",
        kind: "shape",
        shape: "rectangle",
        x: 10,
        y: 20,
        width: 320,
        height: 180,
        fill: "#bfdbfe",
        stroke: "#2563eb",
        opacity: 0.35,
        locked: true,
        zIndex: 2,
      },
    ];

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/labs/${labId}/canvas/drawings`,
      payload: { drawings },
    });

    expect(patchResponse.statusCode, patchResponse.body).toBe(200);
    const patchPayload = patchResponse.json() as {
      lab: {
        document: {
          canvas: {
            drawings: typeof drawings;
          };
        };
      };
    };
    expect(patchPayload.lab.document.canvas.drawings).toEqual(drawings);
    expect((await getLab(labId))?.document.canvas.drawings).toEqual(drawings);
  });

  it("moves multiple node positions in one request", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Batch Move Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const firstNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "linux-alpine-container",
        name: "host-1",
        position: { x: 10, y: 10 },
      },
    });
    const secondNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "linux-alpine-container",
        name: "host-2",
        position: { x: 40, y: 40 },
      },
    });
    const firstNodeId = (
      firstNodeResponse.json() as {
        lab: { document: { nodes: Array<{ id: string }> } };
      }
    ).lab.document.nodes[0]!.id;
    const secondNodeId = (
      secondNodeResponse.json() as {
        lab: { document: { nodes: Array<{ id: string }> } };
      }
    ).lab.document.nodes[1]!.id;

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/labs/${labId}/nodes/positions`,
      payload: {
        moves: [
          { nodeId: firstNodeId, position: { x: 120, y: 140 } },
          { nodeId: secondNodeId, position: { x: 220, y: 240 } },
        ],
      },
    });

    expect(patchResponse.statusCode, patchResponse.body).toBe(200);
    const positions = (
      patchResponse.json() as {
        lab: {
          document: {
            nodes: Array<{ id: string; position: { x: number; y: number } }>;
          };
        };
      }
    ).lab.document.nodes.map((node) => [node.id, node.position]);
    expect(Object.fromEntries(positions)).toMatchObject({
      [firstNodeId]: { x: 120, y: 140 },
      [secondNodeId]: { x: 220, y: 240 },
    });
  });

  it("creates a one-off container node in the current lab", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "One-Off Container Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const response = await app.inject({
      method: "POST",
      url: `/labs/${labId}/container-nodes`,
      payload: {
        displayName: "oraclelinux-1",
        imageRef: "oraclelinux:9-slim",
        registry: "docker-hub",
        engine: "docker",
        shell: "sh",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      lab: expect.objectContaining({
        document: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              name: "oraclelinux-1",
              runtime: "container",
              templateId: "linux-alpine-container",
              config: expect.objectContaining({
                containerImageRef: "oraclelinux:9-slim",
                containerRegistry: "docker-hub",
                containerEngine: "docker",
                containerShell: "sh",
              }),
            }),
          ]),
        }),
      }),
    });
  });

  it("returns the updated lab when setting a boot action", async () => {
    const { labId, nodeId } = await createLabWithNode("node-boot");
    const patchPayload = await patchBootAction(labId, nodeId, {
      startupConfig: "once",
      runningConfigBackup: "none",
    });

    expect(Array.isArray(patchPayload.lab.document.nodeBootActions)).toBe(true);
    expect(patchPayload.lab.document.nodeBootActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId,
          startupConfig: "once",
          runningConfigBackup: "none",
        }),
      ]),
    );

    const getLabResponse = await app.inject({
      method: "GET",
      url: `/labs/${labId}`,
    });
    const getPayload = getLabResponse.json() as {
      lab: {
        document: {
          nodeBootActions: NodeBootActionState[];
        };
      };
    };

    expect(getPayload.lab.document.nodeBootActions).toEqual(
      patchPayload.lab.document.nodeBootActions,
    );
  });

  it("records a backup-once boot action", async () => {
    const { labId, nodeId } = await createLabWithNode("node-backup");
    const patchPayload = await patchBootAction(labId, nodeId, {
      startupConfig: "none",
      runningConfigBackup: "once",
    });
    expect(patchPayload.lab.document.nodeBootActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId,
          startupConfig: "none",
          runningConfigBackup: "once",
        }),
      ]),
    );
  });

  it("records always boot policies", async () => {
    const { labId, nodeId } = await createLabWithNode("node-always");
    const patchPayload = await patchBootAction(labId, nodeId, {
      startupConfig: "always",
      runningConfigBackup: "always",
    });

    expect(patchPayload.lab.document.nodeBootActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId,
          startupConfig: "always",
          runningConfigBackup: "always",
        }),
      ]),
    );
  });

  it("returns running-config backups for a node", async () => {
    const { labId, nodeId } = await createLabWithNode("node-api-backup");
    await appendRunningConfigBackupRecord({
      id: "backup-1",
      labId,
      nodeId,
      status: "captured",
      source: "Boot backup",
      createdAt: "2026-04-12T00:00:00.000Z",
    });

    const response = await app.inject({
      method: "GET",
      url: `/labs/${labId}/nodes/${nodeId}/running-config-backups`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      backups: expect.arrayContaining([
        expect.objectContaining({
          id: "backup-1",
          status: "captured",
          source: "Boot backup",
        }),
      ]),
    });
  });

  it("updates and persists cloud role and bridge group", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Cloud Node Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "cloud",
        name: "cloud-1",
        position: { x: 10, y: 10 },
      },
    });
    const nodeId = (
      addNodeResponse.json() as {
        lab: {
          document: { nodes: Array<{ id: string }> };
        };
      }
    ).lab.document.nodes[0]!.id;

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/labs/${labId}/nodes/${nodeId}/settings`,
      payload: {
        cloudRole: "private-circuit",
        bridgeGroup: "mpls-core",
      },
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toEqual({
      lab: expect.objectContaining({
        document: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: nodeId,
              config: expect.objectContaining({
                cloudRole: "private-circuit",
                bridgeGroup: "mpls-core",
              }),
            }),
          ]),
        }),
      }),
    });

    const getLabResponse = await app.inject({
      method: "GET",
      url: `/labs/${labId}`,
    });
    expect(getLabResponse.statusCode).toBe(200);
    expect(getLabResponse.json()).toEqual({
      lab: expect.objectContaining({
        document: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: nodeId,
              config: expect.objectContaining({
                cloudRole: "private-circuit",
                bridgeGroup: "mpls-core",
              }),
            }),
          ]),
        }),
      }),
    });
  });

  it("rejects updating a private cloud without a bridge group", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Cloud Node Raw Interface Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "cloud",
        name: "cloud-1",
        position: { x: 10, y: 10 },
      },
    });
    const nodeId = (
      addNodeResponse.json() as {
        lab: {
          document: { nodes: Array<{ id: string }> };
        };
      }
    ).lab.document.nodes[0]!.id;

    const patchResponse = await app.inject({
      method: "PATCH",
      url: `/labs/${labId}/nodes/${nodeId}/settings`,
      payload: {
        cloudRole: "private-circuit",
        bridgeGroup: null,
      },
    });

    expect(patchResponse.statusCode).toBe(400);
    expect(patchResponse.json()).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("bridge group"),
      }),
    );
  });

  it("creates a cloud node with management role defaults", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Cloud Create Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "cloud",
        name: "cloud-1",
        position: { x: 10, y: 10 },
        cloudRole: "management",
        bridgeGroup: "management",
      },
    });

    expect(addNodeResponse.statusCode).toBe(201);
    expect(addNodeResponse.json()).toEqual({
      lab: expect.objectContaining({
        document: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              name: "cloud-1",
              config: expect.objectContaining({
                cloudRole: "management",
                bridgeGroup: "management",
              }),
            }),
          ]),
        }),
      }),
    });
  });

  it("rejects creating a private cloud without a bridge group", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Cloud Create Raw Interface Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "cloud",
        name: "cloud-1",
        position: { x: 10, y: 10 },
        cloudRole: "private-circuit",
      },
    });

    expect(addNodeResponse.statusCode).toBe(400);
    expect(addNodeResponse.json()).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("bridge group"),
      }),
    );
  });

  it("clears boot actions when the payload uses action none", async () => {
    const { labId, nodeId } = await createLabWithNode("node-boot-clear");
    await patchBootAction(labId, nodeId, {
      startupConfig: "once",
      runningConfigBackup: "none",
    });
    const clearPayload = await patchBootAction(labId, nodeId, {
      startupConfig: "none",
      runningConfigBackup: "none",
    });

    expect(
      clearPayload.lab.document.nodeBootActions.some(
        (entry) => entry.nodeId === nodeId,
      ),
    ).toBe(false);

    const getLabResponse = await app.inject({
      method: "GET",
      url: `/labs/${labId}`,
    });
    const getPayload = getLabResponse.json() as {
      lab: {
        document: {
          nodeBootActions: NodeBootActionState[];
        };
      };
    };

    expect(
      getPayload.lab.document.nodeBootActions.some(
        (entry) => entry.nodeId === nodeId,
      ),
    ).toBe(false);
  });

  it("rejects invalid boot action values", async () => {
    const { labId, nodeId } = await createLabWithNode("node-invalid-action");
    const response = await app.inject({
      method: "PATCH",
      url: `/labs/${labId}/nodes/${nodeId}/boot-action`,
      payload: {
        startupConfig: "invalid-action",
        runningConfigBackup: "none",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(
      expect.objectContaining({ message: expect.any(String) }),
    );
  });

  it("returns 404 when the lab cannot be found", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/labs/nonexistent-lab/nodes/node-missing/boot-action`,
      payload: { startupConfig: "once", runningConfigBackup: "none" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: "Lab not found" });
  });

  it("returns 404 when the node cannot be found", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Missing Node Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const response = await app.inject({
      method: "PATCH",
      url: `/labs/${labId}/nodes/nonexistent-node/boot-action`,
      payload: { startupConfig: "once", runningConfigBackup: "none" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ message: "Node not found" });
  });

  it("writes a backup snapshot after a lab mutation when auto backup is enabled", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Backup Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const toggleResponse = await app.inject({
      method: "PATCH",
      url: `/labs/${labId}/auto-backup`,
      payload: { autoBackup: true },
    });
    expect(toggleResponse.statusCode).toBe(200);

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "cisco-iosv",
        name: "host-1",
        position: { x: 120, y: 80 },
      },
    });

    expect(addNodeResponse.statusCode).toBe(201);

    const backupDir = path.join(tempDataDir, "lab-backups", labId);
    const backups = await readdir(backupDir);
    expect(backups.length).toBeGreaterThan(0);
  });

  it("still applies lab mutations when the backup snapshot fails", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Readonly Backup Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const toggleResponse = await app.inject({
      method: "PATCH",
      url: `/labs/${labId}/auto-backup`,
      payload: { autoBackup: true },
    });
    expect(toggleResponse.statusCode).toBe(200);

    const backupDir = path.join(tempDataDir, "lab-backups", labId);
    await mkdir(backupDir, { recursive: true });
    await chmod(backupDir, 0o555);

    try {
      const addNodeResponse = await app.inject({
        method: "POST",
        url: `/labs/${labId}/nodes`,
        payload: {
          templateId: "cisco-iosv",
          name: "host-readonly",
          position: { x: 120, y: 80 },
        },
      });
      expect(addNodeResponse.statusCode).toBe(201);
    } finally {
      await chmod(backupDir, 0o755);
    }
  });

  it("keeps labs.json valid across overlapping lab updates", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Atomic Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    await Promise.all([
      app.inject({
        method: "PATCH",
        url: `/labs/${labId}`,
        payload: { name: "Atomic Lab A" },
      }),
      app.inject({
        method: "PATCH",
        url: `/labs/${labId}`,
        payload: { name: "Atomic Lab B" },
      }),
    ]);

    const listResponse = await app.inject({ method: "GET", url: "/labs" });
    expect(listResponse.statusCode).toBe(200);
    const payload = listResponse.json() as {
      labs: Array<{ id: string; name: string }>;
    };
    expect(payload.labs.some((lab) => lab.id === labId)).toBe(true);

    const persisted = await getLab(labId);
    expect(["Atomic Lab A", "Atomic Lab B"]).toContain(persisted?.name);
  });

  it("does not write backups when auto backup is disabled", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "No Backup Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "cisco-iosv",
        name: "host-1",
        position: { x: 120, y: 80 },
      },
    });

    expect(addNodeResponse.statusCode).toBe(201);

    await expect(
      access(path.join(tempDataDir, "lab-backups", labId)),
    ).rejects.toThrow();
  });

  it("lists backups for a lab and restores a selected snapshot", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Restore Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    await app.inject({
      method: "PATCH",
      url: `/labs/${labId}/auto-backup`,
      payload: { autoBackup: true },
    });
    await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "cisco-iosv",
        name: "host-1",
        position: { x: 120, y: 80 },
      },
    });

    const backupsResponse = await app.inject({
      method: "GET",
      url: `/labs/${labId}/backups`,
    });
    expect(backupsResponse.statusCode).toBe(200);
    const backupsPayload = backupsResponse.json() as {
      backups: Array<{ fileName: string }>;
    };
    expect(backupsPayload.backups.length).toBeGreaterThan(0);

    await app.inject({
      method: "PATCH",
      url: `/labs/${labId}`,
      payload: { name: "Mutated Lab" },
    });

    const restoreResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/restore-backup`,
      payload: { fileName: backupsPayload.backups[0]?.fileName },
    });

    expect(restoreResponse.statusCode).toBe(200);
    const restored = await getLab(labId);
    expect(restored?.document.nodes.length).toBeGreaterThan(0);
  });

  it("creates a network and attaches node interfaces to it", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Link Lab" },
    });
    const createdLab = createLabResponse.json() as { lab: { id: string } };

    const addFirstNode = await app.inject({
      method: "POST",
      url: `/labs/${createdLab.lab.id}/nodes`,
      payload: {
        templateId: "cisco-iosv",
        name: "host-1",
        position: { x: 10, y: 10 },
      },
    });
    const firstNode = (
      addFirstNode.json() as {
        lab: {
          document: {
            nodes: Array<{ id: string; interfaces: Array<{ id: string }> }>;
          };
        };
      }
    ).lab.document.nodes[0];

    const addSecondNode = await app.inject({
      method: "POST",
      url: `/labs/${createdLab.lab.id}/nodes`,
      payload: {
        templateId: "cisco-iosv",
        name: "host-2",
        position: { x: 200, y: 10 },
      },
    });
    const secondNode = (
      addSecondNode.json() as {
        lab: {
          document: {
            nodes: Array<{ id: string; interfaces: Array<{ id: string }> }>;
          };
        };
      }
    ).lab.document.nodes[1];

    const createNetworkResponse = await app.inject({
      method: "POST",
      url: `/labs/${createdLab.lab.id}/networks`,
      payload: { name: "host-link", visible: false },
    });
    expect(createNetworkResponse.statusCode).toBe(201);
    const networkId = (
      createNetworkResponse.json() as { network: { id: string } }
    ).network.id;

    const attachResponse = await app.inject({
      method: "POST",
      url: `/labs/${createdLab.lab.id}/attachments`,
      payload: {
        networkId,
        interfaceIds: [
          firstNode.interfaces[0]?.id,
          secondNode.interfaces[0]?.id,
        ],
      },
    });

    expect(attachResponse.statusCode).toBe(201);

    const getLabResponse = await app.inject({
      method: "GET",
      url: `/labs/${createdLab.lab.id}`,
    });
    const payload = getLabResponse.json() as {
      lab: {
        document: {
          networks: Array<{ id: string }>;
          attachments: Array<{ interfaceId: string; networkId: string }>;
        };
      };
    };

    expect(
      payload.lab.document.networks.some((network) => network.id === networkId),
    ).toBe(true);
    expect(payload.lab.document.attachments).toHaveLength(2);
  });

  it("rejects attaching an interface that is already in use", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Port Conflict Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "cisco-iosv",
        name: "host-1",
        position: { x: 10, y: 10 },
      },
    });
    const node = (
      addNodeResponse.json() as {
        lab: {
          document: {
            nodes: Array<{ id: string; interfaces: Array<{ id: string }> }>;
          };
        };
      }
    ).lab.document.nodes[0]!;

    const firstNetworkResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/networks`,
      payload: { name: "first-link", visible: false },
    });
    const firstNetworkId = (
      firstNetworkResponse.json() as { network: { id: string } }
    ).network.id;

    const secondNetworkResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/networks`,
      payload: { name: "second-link", visible: false },
    });
    const secondNetworkId = (
      secondNetworkResponse.json() as { network: { id: string } }
    ).network.id;

    await app.inject({
      method: "POST",
      url: `/labs/${labId}/attachments`,
      payload: {
        networkId: firstNetworkId,
        interfaceIds: [node.interfaces[0]!.id],
      },
    });

    const conflictResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/attachments`,
      payload: {
        networkId: secondNetworkId,
        interfaceIds: [node.interfaces[0]!.id],
      },
    });

    expect(conflictResponse.statusCode).toBe(409);
    expect(conflictResponse.json()).toMatchObject({
      message: expect.stringMatching(/already attached/i),
    });
    expect((await getLab(labId))?.document.attachments).toEqual([
      { interfaceId: node.interfaces[0]!.id, networkId: firstNetworkId },
    ]);
  });

  it("powers on and off a node while tracking runtime state", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Runtime Lab" },
    });
    const createdLab = createLabResponse.json() as { lab: { id: string } };

    await app.inject({
      method: "POST",
      url: "/images/scan",
      payload: { imageDir: "/tmp" },
    });

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${createdLab.lab.id}/nodes`,
      payload: {
        templateId: "linux-alpine-container",
        name: "toolbox-1",
        position: { x: 100, y: 100 },
      },
    });
    const nodeId = (
      addNodeResponse.json() as {
        lab: { document: { nodes: Array<{ id: string }> } };
      }
    ).lab.document.nodes[0]?.id;

    const powerOnResponse = await app.inject({
      method: "POST",
      url: `/labs/${createdLab.lab.id}/nodes/${nodeId}/power-on`,
    });
    expect(powerOnResponse.statusCode).toBe(200);

    const runtimeResponse = await app.inject({
      method: "GET",
      url: `/labs/${createdLab.lab.id}/runtime`,
    });
    const runtimePayload = runtimeResponse.json() as {
      states: Array<{ nodeId: string; status: string }>;
    };
    expect(
      runtimePayload.states.some(
        (state) => state.nodeId === nodeId && state.status === "running",
      ),
    ).toBe(true);

    const powerOffResponse = await app.inject({
      method: "POST",
      url: `/labs/${createdLab.lab.id}/nodes/${nodeId}/power-off`,
    });
    expect(powerOffResponse.statusCode).toBe(200);
  });

  it("marks a qemu runtime console as busy when an external client is attached", async () => {
    const busyApp = buildApp({
      runtime: {
        runCommand: async (command, args) => {
          if (command === "ps" && args[0] === "-p" && args[1] === "23812") {
            return {
              ok: true,
              stdout:
                "qemu-system-x86_64 -serial tcp:127.0.0.1:5002,server,nowait",
              stderr: "",
            };
          }

          if (
            command === "lsof" &&
            args[0] === "-nP" &&
            args.includes("-iTCP:5002")
          ) {
            return {
              ok: true,
              stdout:
                "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nqemu-syst 23812 cass 18u IPv4 0x0 0t0 TCP 127.0.0.1:5002 (LISTEN)\ntelnet 88819 cass 5u IPv4 0x0 0t0 TCP 127.0.0.1:58723->127.0.0.1:5002 (ESTABLISHED)\n",
              stderr: "",
            };
          }

          return { ok: true, stdout: "", stderr: "" };
        },
        hasBinary: async () => false,
      },
    });

    const createLabResponse = await busyApp.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Busy Console Lab" },
    });
    const createdLab = createLabResponse.json() as { lab: { id: string } };

    const nodeId = "node-busy-console";
    await upsertRuntimeState({
      labId: createdLab.lab.id,
      nodeId,
      status: "running",
      runtime: "qemu",
      accelerationMode: "tcg",
      externalId: "23812",
      connectCommand: ["telnet", "127.0.0.1", "5002"],
      consolePort: 5002,
      message: null,
      commandPreview: ["qemu-system-x86_64"],
      updatedAt: new Date().toISOString(),
    });

    const runtimeResponse = await busyApp.inject({
      method: "GET",
      url: `/labs/${createdLab.lab.id}/runtime`,
    });
    const runtimePayload = runtimeResponse.json() as {
      states: Array<{
        nodeId: string;
        consoleInUse: boolean;
        message: string | null;
      }>;
    };

    expect(
      runtimePayload.states.some(
        (state) => state.nodeId === nodeId && state.consoleInUse === true,
      ),
    ).toBe(true);
    expect(
      runtimePayload.states.find((state) => state.nodeId === nodeId)?.message,
    ).toContain("already in use");

    await busyApp.close();
  });

  it("disconnects only external console clients for the selected node", async () => {
    const killed: string[][] = [];
    const disconnectApp = buildApp({
      runtime: {
        runCommand: async (command, args) => {
          if (command === "lsof" && args.includes("-iTCP:5002")) {
            return {
              ok: true,
              stdout:
                "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nqemu-syst 23812 cass 18u IPv4 0x0 0t0 TCP 127.0.0.1:5002 (LISTEN)\nnc 92403 cass 3u IPv4 0x0 0t0 TCP 127.0.0.1:51163->127.0.0.1:5002 (ESTABLISHED)\nsocat 98246 cass 5u IPv4 0x0 0t0 TCP 127.0.0.1:51348->127.0.0.1:5002 (ESTABLISHED)\n",
              stderr: "",
            };
          }

          if (command === "kill") {
            killed.push(args);
            return { ok: true, stdout: "", stderr: "" };
          }

          return { ok: true, stdout: "", stderr: "" };
        },
        hasBinary: async () => false,
      },
    });

    const labResponse = await disconnectApp.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Disconnect Lab" },
    });
    const labId = (labResponse.json() as { lab: { id: string } }).lab.id;

    await upsertRuntimeState({
      labId,
      nodeId: "node-1",
      status: "running",
      runtime: "qemu",
      accelerationMode: "tcg",
      externalId: "23812",
      connectCommand: ["telnet", "127.0.0.1", "5002"],
      consolePort: 5002,
      message: "Serial console already in use by another client.",
      commandPreview: ["qemu-system-x86_64"],
      updatedAt: new Date().toISOString(),
    });

    const response = await disconnectApp.inject({
      method: "POST",
      url: `/labs/${labId}/nodes/node-1/disconnect-console`,
    });

    expect(response.statusCode).toBe(200);
    expect(killed).toEqual([["92403", "98246"]]);

    await disconnectApp.close();
  });

  it("reconciles stale running runtime states when the host no longer has the backing processes", async () => {
    const reconcileApp = buildApp({
      runtime: {
        runCommand: async (command, args) => {
          if (command === "ps" && args[0] === "-p") {
            return { ok: false, stdout: "", stderr: "process not found" };
          }

          if (command === "lsof") {
            return { ok: true, stdout: "", stderr: "" };
          }

          return { ok: false, stdout: "", stderr: "not running" };
        },
        hasBinary: async () => false,
      },
    });

    const labResponse = await reconcileApp.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Stale Runtime Lab" },
    });
    const labId = (labResponse.json() as { lab: { id: string } }).lab.id;

    await upsertRuntimeState({
      labId,
      nodeId: "node-qemu-stale",
      status: "running",
      runtime: "qemu",
      accelerationMode: "tcg",
      externalId: "4321",
      connectCommand: ["telnet", "127.0.0.1", "5002"],
      consolePort: 5002,
      message: null,
      commandPreview: ["qemu-system-x86_64"],
      updatedAt: new Date().toISOString(),
    });

    await upsertRuntimeState({
      labId,
      nodeId: "node-cloud-stale",
      status: "running",
      runtime: "cloud",
      accelerationMode: null,
      externalId: "cloud-tap",
      message: null,
      commandPreview: [],
      updatedAt: new Date().toISOString(),
    });

    const response = await reconcileApp.inject({
      method: "GET",
      url: `/labs/${labId}/runtime`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      states: expect.arrayContaining([
        expect.objectContaining({
          nodeId: "node-qemu-stale",
          status: "stopped",
        }),
        expect.objectContaining({
          nodeId: "node-cloud-stale",
          status: "running",
        }),
      ]),
    });

    const persistedStates = await listRuntimeStates(labId);
    expect(
      persistedStates.find(
        (state: { nodeId: string; status: string }) =>
          state.nodeId === "node-qemu-stale",
      )?.status,
    ).toBe("stopped");
    expect(
      persistedStates.find(
        (state: { nodeId: string; status: string }) =>
          state.nodeId === "node-cloud-stale",
      )?.status,
    ).toBe("running");

    await reconcileApp.close();
  });

  it("deletes a node and removes its connected cable attachments", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Delete Node Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const addNodeResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "linux-alpine-container",
        name: "node-1",
        position: { x: 10, y: 10 },
      },
    });
    const node = (
      addNodeResponse.json() as {
        lab: {
          document: {
            nodes: Array<{ id: string; interfaces: Array<{ id: string }> }>;
          };
        };
      }
    ).lab.document.nodes[0]!;

    const networkResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/networks`,
      payload: { name: "link", visible: false },
    });
    const networkId = (networkResponse.json() as { network: { id: string } })
      .network.id;

    await app.inject({
      method: "POST",
      url: `/labs/${labId}/attachments`,
      payload: { networkId, interfaceIds: [node.interfaces[0]!.id] },
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/labs/${labId}/nodes/${node.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(
      (await getLab(labId))?.document.nodes.some(
        (savedNode) => savedNode.id === node.id,
      ),
    ).toBe(false);
    expect((await getLab(labId))?.document.attachments).toHaveLength(0);
  });

  it("deletes a point-to-point cable network", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Delete Cable Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const networkResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/networks`,
      payload: { name: "link", visible: false },
    });
    const networkId = (networkResponse.json() as { network: { id: string } })
      .network.id;

    const response = await app.inject({
      method: "DELETE",
      url: `/labs/${labId}/networks/${networkId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(
      (await getLab(labId))?.document.networks.some(
        (network) => network.id === networkId,
      ),
    ).toBe(false);
  });

  it("deletes an entire lab after cleaning node runtime state", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Delete Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "linux-alpine-container",
        name: "node-1",
        position: { x: 10, y: 10 },
      },
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/labs/${labId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(await getLab(labId)).toBeNull();
  });

  it("renames a lab", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Old Lab Name" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const response = await app.inject({
      method: "PATCH",
      url: `/labs/${labId}`,
      payload: { name: "Renamed Lab" },
    });

    expect(response.statusCode).toBe(200);
    expect((await getLab(labId))?.name).toBe("Renamed Lab");
    expect((await getLab(labId))?.document.name).toBe("Renamed Lab");
  });

  it("renames a node", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Node Rename Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "linux-alpine-container",
        name: "old-node",
        position: { x: 10, y: 10 },
      },
    });

    const nodeId = (await getLab(labId))?.document.nodes[0]?.id;
    expect(nodeId).toBeTruthy();

    const response = await app.inject({
      method: "PATCH",
      url: `/labs/${labId}/nodes/${nodeId}`,
      payload: { name: "new-node" },
    });

    expect(response.statusCode).toBe(200);
    expect((await getLab(labId))?.document.nodes[0]?.name).toBe("new-node");
  });

  it("uploads a qcow2 image into managed storage", async () => {
    const boundary = "----networkchum";
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="csr1000v.qcow2"',
      "Content-Type: application/octet-stream",
      "",
      "qcow2-data",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/images/upload",
      payload,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });

    expect(response.statusCode).toBe(201);
    const uploaded = response.json() as { image: { path: string } };
    await expect(access(uploaded.image.path)).resolves.toBeUndefined();
  });

  it("unbinds and catalog-removes an image without deleting its file", async () => {
    const imagePath = path.join(
      tempDataDir,
      "images",
      "uploads",
      "csr1000v.qcow2",
    );
    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(imagePath, "qcow2-data");
    await saveImages([
      {
        id: "img-1",
        name: "csr1000v.qcow2",
        path: imagePath,
        format: "qcow2",
        sizeBytes: 10,
        updatedAt: new Date().toISOString(),
        templateId: "cisco-asr",
        suggestedTemplateId: "cisco-asr",
        source: "upload",
        catalogState: "active",
      },
    ]);

    const unbind = await app.inject({
      method: "DELETE",
      url: "/images/img-1/template-binding",
    });
    const remove = await app.inject({ method: "DELETE", url: "/images/img-1" });

    expect(unbind.statusCode).toBe(200);
    expect(remove.statusCode).toBe(200);
    await expect(access(imagePath)).resolves.toBeUndefined();
  });

  it("permanently deletes an image file and removes its record", async () => {
    const imagePath = path.join(tempDataDir, "images", "blank-1G.qcow2");
    await mkdir(path.dirname(imagePath), { recursive: true });
    await writeFile(imagePath, "qcow2-data");
    await saveImages([
      {
        id: "img-delete",
        name: "blank-1G.qcow2",
        path: imagePath,
        format: "qcow2",
        sizeBytes: 10,
        updatedAt: new Date().toISOString(),
        templateId: null,
        suggestedTemplateId: null,
        source: "scan",
        catalogState: "active",
      },
    ]);

    const response = await app.inject({
      method: "DELETE",
      url: "/images/img-delete/file",
    });

    expect(response.statusCode).toBe(200);
    await expect(access(imagePath)).rejects.toThrow();
  });
});

describe("api token auth", () => {
  it("requires the token on every route except health when configured", async () => {
    process.env.NETWORKCHUM_API_TOKEN = "test-token-1234";
    const guarded = buildApp();
    try {
      const health = await guarded.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);

      const denied = await guarded.inject({ method: "GET", url: "/labs" });
      expect(denied.statusCode).toBe(401);
      expect(denied.json()).toEqual({
        message: "Unauthorized: API token required",
      });

      const deniedPost = await guarded.inject({
        method: "POST",
        url: "/labs",
        payload: { name: "x" },
      });
      expect(deniedPost.statusCode).toBe(401);

      const wrongToken = await guarded.inject({
        method: "GET",
        url: "/labs",
        headers: { "x-networkchum-token": "nope" },
      });
      expect(wrongToken.statusCode).toBe(401);

      const headerToken = await guarded.inject({
        method: "GET",
        url: "/labs",
        headers: { "x-networkchum-token": "test-token-1234" },
      });
      expect(headerToken.statusCode).toBe(200);

      const bearerToken = await guarded.inject({
        method: "GET",
        url: "/labs",
        headers: { authorization: "Bearer test-token-1234" },
      });
      expect(bearerToken.statusCode).toBe(200);
    } finally {
      delete process.env.NETWORKCHUM_API_TOKEN;
      await guarded.close();
    }
  });
});

describe("api token auth CORS", () => {
  it("exposes 401 responses to cross-origin browsers", async () => {
    process.env.NETWORKCHUM_API_TOKEN = "test-token-1234";
    const guarded = buildApp();
    try {
      const denied = await guarded.inject({
        method: "GET",
        url: "/labs",
        headers: { origin: "http://192.168.2.57:5173" },
      });
      expect(denied.statusCode).toBe(401);
      expect(denied.headers["access-control-allow-origin"]).toBe(
        "http://192.168.2.57:5173",
      );
    } finally {
      delete process.env.NETWORKCHUM_API_TOKEN;
      await guarded.close();
    }
  });
});

describe("lab bridge nodes", () => {
  it("creates a lab-bridge node with the peer lab reference", async () => {
    const createLabResponse = await app.inject({
      method: "POST",
      url: "/labs",
      payload: { name: "Bridge Lab" },
    });
    const labId = (createLabResponse.json() as { lab: { id: string } }).lab.id;

    const response = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes`,
      payload: {
        templateId: "lab-bridge",
        name: "NY-Bridge",
        position: { x: 60, y: 60 },
        peerLabId: "lab-1792526674794-b51xfk",
      },
    });

    expect(response.statusCode).toBe(201);
    const payload = response.json() as {
      lab: { document: { nodes: Array<{ config: { peerLabId?: string } }> } };
    };
    const node = payload.lab.document.nodes.find((n) => n.name === "NY-Bridge");
    expect(node?.config.peerLabId).toBe("lab-1792526674794-b51xfk");
    const bridgeNodeId = node!.id;

    // Bridge nodes have no power lifecycle.
    const powerResponse = await app.inject({
      method: "POST",
      url: `/labs/${labId}/nodes/${bridgeNodeId}/power-on`,
      payload: {},
    });
    expect(powerResponse.statusCode).toBe(404);
  });
});
