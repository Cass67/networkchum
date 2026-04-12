import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLab, getLab, updateLabDocument } from "../labs/labStore.js";
import { addNode } from "../topology/mutations.js";
import { TemplateRegistry } from "../templates/templateRegistry.js";
import { findAvailableQemuPortBase, powerOnNode } from "./powerNode.js";
import { upsertRuntimeState } from "./runtimeStateStore.js";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("powerOnNode", () => {
  it("chooses a serial base where both serial and monitor ports are free", async () => {
    const usedPorts = new Set([5000, 5001]);

    const basePort = await findAvailableQemuPortBase(
      5000,
      async (port) => !usedPorts.has(port),
    );

    expect(basePort).toBe(5002);
  });

  it("returns a real docker-backed runtime state for container nodes", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Container Lab");
    const template = registry.get("linux-alpine-container")!;
    const document = addNode(lab.document, {
      template,
      name: "alpine-1",
      position: { x: 10, y: 10 },
    });
    await updateLabDocument(lab.id, document);
    const savedLab = await getLab(lab.id);
    const nodeId = savedLab!.document.nodes[0]!.id;

    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async (command, args) => {
        expect(command).toBe("docker");
        expect(args).toContain("run");
        return { ok: true, stdout: "container-id-123", stderr: "" };
      },
      hasBinary: async () => true,
    });

    expect(state?.status).toBe("running");
    expect(state?.externalId).toBe("container-id-123");
    expect(state?.connectCommand).toEqual([
      "docker",
      "exec",
      "-it",
      "container-id-123",
      "sh",
    ]);
  });

  it("returns failed state for qemu nodes when no qemu binary exists", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Qemu Lab");
    const template = registry.get("linux-generic-vm")!;
    const document = addNode(lab.document, {
      template,
      name: "vm-1",
      position: { x: 10, y: 10 },
      imageId: "/tmp/vm.qcow2",
    });
    await updateLabDocument(lab.id, document);
    const savedLab = await getLab(lab.id);
    const nodeId = savedLab!.document.nodes[0]!.id;

    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
      hasBinary: async () => false,
    });

    expect(state?.status).toBe("failed");
    expect(state?.message).toContain("qemu");
  });

  it("returns running state with serial console for qemu nodes when binary exists", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Qemu Live Lab");
    const template = registry.get("linux-generic-vm")!;
    const document = addNode(lab.document, {
      template,
      name: "vm-live",
      position: { x: 10, y: 10 },
      imageId: "/tmp/vm.qcow2",
    });
    await updateLabDocument(lab.id, document);
    const savedLab = await getLab(lab.id);
    const nodeId = savedLab!.document.nodes[0]!.id;

    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
      hasBinary: async () => true,
      findAvailablePort: async (port) => port,
      launchQemu: async () => ({ ok: true, pid: 12345, stderr: "" }),
    });

    expect(state?.status).toBe("running");
    expect(state?.externalId).toBe("12345");
    expect(state?.connectCommand).toEqual(["telnet", "127.0.0.1", "5000"]);
  });

  it("returns failed state when qemu launch fails", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Qemu Fail Lab");
    const template = registry.get("linux-generic-vm")!;
    const document = addNode(lab.document, {
      template,
      name: "vm-fail",
      position: { x: 10, y: 10 },
      imageId: "/nonexistent.qcow2",
    });
    await updateLabDocument(lab.id, document);
    const savedLab = await getLab(lab.id);
    const nodeId = savedLab!.document.nodes[0]!.id;

    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
      hasBinary: async () => true,
      findAvailablePort: async (port) => port,
      launchQemu: async () => ({
        ok: false,
        pid: null,
        stderr: "Could not open /nonexistent.qcow2",
      }),
    });

    expect(state?.status).toBe("failed");
    expect(state?.message).toContain("nonexistent");
    expect(state?.connectCommand).toBeUndefined();
  });

  it("returns failed state when no bound image exists and the fallback disk is missing", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Qemu Missing Fallback Lab");
    const template = registry.get("linux-generic-vm")!;
    const document = addNode(lab.document, {
      template,
      name: "vm-no-image",
      position: { x: 10, y: 10 },
    });
    await updateLabDocument(lab.id, document);
    const savedLab = await getLab(lab.id);
    const nodeId = savedLab!.document.nodes[0]!.id;

    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
      hasBinary: async () => true,
      launchQemu: async () => {
        throw new Error("should not launch without a fallback disk image");
      },
    });

    expect(state?.status).toBe("failed");
    expect(state?.message).toContain("blank-1G.qcow2");
  });

  it("returns the existing running qemu state instead of launching the same node twice", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Qemu Existing Lab");
    const template = registry.get("arista-veos")!;
    const document = addNode(lab.document, {
      template,
      name: "veos-1",
      position: { x: 10, y: 10 },
      imageId: "/tmp/vm.qcow2",
    });
    await updateLabDocument(lab.id, document);
    const savedLab = await getLab(lab.id);
    const nodeId = savedLab!.document.nodes[0]!.id;

    await upsertRuntimeState({
      labId: lab.id,
      nodeId,
      status: "running",
      runtime: "qemu",
      accelerationMode: "tcg",
      externalId: "99999",
      connectCommand: ["telnet", "127.0.0.1", "5004"],
      consolePort: 5004,
      message: null,
      commandPreview: ["qemu-system-x86_64"],
      updatedAt: new Date().toISOString(),
    });

    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
      hasBinary: async () => true,
      launchQemu: async () => {
        throw new Error("should not launch twice");
      },
    });

    expect(state?.status).toBe("running");
    expect(state?.externalId).toBe("99999");
    expect(state?.connectCommand).toEqual(["telnet", "127.0.0.1", "5004"]);
  });

  it("recovers a stale failed state when the overlay is still held by a live qemu process", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Qemu Recovery Lab");
    const template = registry.get("arista-veos")!;
    const document = addNode(lab.document, {
      template,
      name: "veos-stale",
      position: { x: 10, y: 10 },
      imageId: "/tmp/vm.qcow2",
    });
    await updateLabDocument(lab.id, document);
    const savedLab = await getLab(lab.id);
    const nodeId = savedLab!.document.nodes[0]!.id;

    await upsertRuntimeState({
      labId: lab.id,
      nodeId,
      status: "failed",
      runtime: "qemu",
      accelerationMode: "tcg",
      externalId: null,
      connectCommand: undefined,
      consolePort: null,
      message: "Failed to get write lock",
      commandPreview: ["qemu-system-x86_64"],
      updatedAt: new Date().toISOString(),
    });

    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async (command, args) => {
        if (command === "lsof" && args[0] === "-t") {
          return { ok: true, stdout: "46250\n", stderr: "" };
        }

        if (command === "ps" && args[0] === "-p") {
          return {
            ok: true,
            stdout:
              "qemu-system-x86_64 -machine q35 -cpu max -serial tcp:127.0.0.1:5004,server,nowait\n",
            stderr: "",
          };
        }

        return { ok: true, stdout: "", stderr: "" };
      },
      hasBinary: async () => true,
      launchQemu: async () => {
        throw new Error(
          "should not relaunch when disk is already locked by qemu",
        );
      },
    });

    expect(state?.runtime).toBe("qemu");
    expect(state?.status).toBe("running");
    expect(state?.externalId).toBe("46250");
    expect((state as { consolePort?: number | null } | null)?.consolePort).toBe(
      5004,
    );
    expect(state?.connectCommand).toEqual(["telnet", "127.0.0.1", "5004"]);
  });
});
