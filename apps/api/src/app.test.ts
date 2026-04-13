import {
  access,
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

import { appendRunningConfigBackupRecord } from "./runtime/runningConfigBackupStore.js";
import { buildApp } from "./app.js";
import { saveImages } from "./images/imageStore.js";
import { getLab } from "./labs/labStore.js";
import { upsertRuntimeState } from "./runtime/runtimeStateStore.js";

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

        return { ok: true, stdout: "", stderr: "" };
      },
      hasBinary: async () => false,
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
    expect(response.json()).toEqual({ ok: true });
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

  it("updates and persists a cloud node bridge interface", async () => {
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
      payload: { bridgeInterface: "eno1" },
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(patchResponse.json()).toEqual({
      lab: expect.objectContaining({
        document: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              id: nodeId,
              config: expect.objectContaining({ bridgeInterface: "eno1" }),
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
              config: expect.objectContaining({ bridgeInterface: "eno1" }),
            }),
          ]),
        }),
      }),
    });
  });

  it("creates a cloud node with a configured bridge interface", async () => {
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
        bridgeInterface: "eno1",
      },
    });

    expect(addNodeResponse.statusCode).toBe(201);
    expect(addNodeResponse.json()).toEqual({
      lab: expect.objectContaining({
        document: expect.objectContaining({
          nodes: expect.arrayContaining([
            expect.objectContaining({
              name: "cloud-1",
              config: expect.objectContaining({ bridgeInterface: "eno1" }),
            }),
          ]),
        }),
      }),
    });
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
