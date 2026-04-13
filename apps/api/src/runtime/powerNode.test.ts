import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { LabDocument } from "@networkchum/shared";

import { createLab, getLab, updateLabDocument } from "../labs/labStore.js";
import { addNode, setNodeBootActions } from "../topology/mutations.js";
import { TemplateRegistry } from "../templates/templateRegistry.js";
import {
  ensureTapNetworking,
  findAvailableQemuPortBase,
  powerOffNode,
  powerOnNode,
} from "./powerNode.js";
import {
  listRuntimeStates,
  upsertRuntimeState,
  type RuntimeState,
} from "./runtimeStateStore.js";
import { virtualSwitch } from "./virtualSwitch.js";

const tempDirs: string[] = [];

async function installFakeCsrTools(tempDir: string): Promise<{
  restorePath: () => void;
  mcopyLogPath: string;
}> {
  const binDir = path.join(tempDir, "bin");
  await mkdir(binDir, { recursive: true });
  const mcopyLogPath = path.join(tempDir, "mcopy.log");

  const scripts = new Map<string, string>([
    [
      "dd",
      `#!/bin/sh
of=""
for arg in "$@"; do
  case "$arg" in
    of=*) of="\${arg#of=}" ;;
  esac
done

if [ -z "$of" ]; then
  exit 1
fi

mkdir -p "$(dirname "$of")"
: > "$of"
`,
    ],
    ["mformat", "#!/bin/sh\nexit 0\n"],
    [
      "mcopy",
      `#!/bin/sh
printf '%s\n' "$*" >> "${mcopyLogPath}"
case "$*" in
  *::iosxe_config.txt*) exit 0 ;;
  *) exit 1 ;;
esac
`,
    ],
  ]);

  await Promise.all(
    Array.from(scripts.entries(), async ([name, contents]) => {
      const scriptPath = path.join(binDir, name);
      await writeFile(scriptPath, contents, "utf8");
      await chmod(scriptPath, 0o755);
    }),
  );

  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${binDir}:${previousPath}`;
  return {
    restorePath: () => {
      process.env.PATH = previousPath;
    },
    mcopyLogPath,
  };
}

afterEach(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  delete process.env.NETWORKCHUM_BIND_MODE;
  delete process.env.NETWORKCHUM_MANAGEMENT_UPLINK;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("powerOnNode", () => {
  it("recreates a stale tap device before launching qemu", async () => {
    const document: LabDocument = {
      id: "lab-abc123",
      name: "Test Lab",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      annotations: [],
      startupConfigSets: [],
      nodeBootActions: [],
      activeConfigSetId: null,
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "node-a",
          name: "router-1",
          runtime: "qemu",
          templateId: "tmpl",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 1024, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-a-0", networkId: "net-1" }],
    };

    const commands: string[][] = [];
    let firstTapCreate = true;
    const result = await ensureTapNetworking(
      document,
      async (command, args) => {
        commands.push([command, ...args]);

        if (
          firstTapCreate &&
          command === "ip" &&
          args[0] === "tuntap" &&
          args[1] === "add"
        ) {
          firstTapCreate = false;
          return {
            ok: false,
            stdout: "",
            stderr: "ioctl(TUNSETIFF): File exists",
          };
        }

        return { ok: true, stdout: "", stderr: "" };
      },
      async () => true,
    );

    expect(result.ok).toBe(true);
    expect(commands).toContainEqual([
      "ip",
      "link",
      "del",
      "dev",
      "tap-c123-odea-0",
    ]);
    expect(
      commands.filter(
        (cmd) => cmd[0] === "ip" && cmd[1] === "tuntap" && cmd[2] === "add",
      ),
    ).toHaveLength(2);
  });

  it("recreates a busy tap device before launching qemu", async () => {
    const document: LabDocument = {
      id: "lab-abc123",
      name: "Test Lab",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      annotations: [],
      startupConfigSets: [],
      nodeBootActions: [],
      activeConfigSetId: null,
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "node-a",
          name: "router-1",
          runtime: "qemu",
          templateId: "tmpl",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 1024, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-a-0", networkId: "net-1" }],
    };

    const commands: string[][] = [];
    let firstTapCreate = true;
    const result = await ensureTapNetworking(
      document,
      async (command, args) => {
        commands.push([command, ...args]);

        if (
          firstTapCreate &&
          command === "ip" &&
          args[0] === "tuntap" &&
          args[1] === "add"
        ) {
          firstTapCreate = false;
          return {
            ok: false,
            stdout: "",
            stderr: "ioctl(TUNSETIFF): Device or resource busy",
          };
        }

        return { ok: true, stdout: "", stderr: "" };
      },
      async () => true,
    );

    expect(result.ok).toBe(true);
    expect(commands).toContainEqual([
      "ip",
      "link",
      "del",
      "dev",
      "tap-c123-odea-0",
    ]);
  });

  it("fails fast when tap networking lacks privileges", async () => {
    const document: LabDocument = {
      id: "lab-abc123",
      name: "Test Lab",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      annotations: [],
      startupConfigSets: [],
      nodeBootActions: [],
      activeConfigSetId: null,
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "node-a",
          name: "router-1",
          runtime: "qemu",
          templateId: "tmpl",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 1024, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-a-0", networkId: "net-1" }],
    };

    const result = await ensureTapNetworking(document, async () => ({
      ok: false,
      stdout: "",
      stderr: "RTNETLINK answers: Operation not permitted",
    }));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected tap networking to fail");
    }
    expect(result.message).toContain("CAP_NET_ADMIN");
  });

  it("fails when tap setup reports success but the tap is still missing", async () => {
    const document: LabDocument = {
      id: "lab-abc123",
      name: "Test Lab",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      annotations: [],
      startupConfigSets: [],
      nodeBootActions: [],
      activeConfigSetId: null,
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "node-a",
          name: "router-1",
          runtime: "qemu",
          templateId: "tmpl",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 1024, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-a-0", networkId: "net-1" }],
    };

    const result = await ensureTapNetworking(
      document,
      async () => ({ ok: true, stdout: "", stderr: "" }),
      async () => false,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected missing tap validation to fail");
    }
    expect(result.message).toContain("expected TAP device");
  });

  it("attaches qemu taps directly to an existing host bridge for cloud-backed networks", async () => {
    const document: LabDocument = {
      id: "lab-abc123",
      name: "Test Lab",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      annotations: [],
      startupConfigSets: [],
      nodeBootActions: [],
      activeConfigSetId: null,
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "cloud-a",
          name: "mgmt",
          runtime: "cloud",
          templateId: "cloud",
          imageId: null,
          position: { x: 0, y: 0 },
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 1,
            cloudRole: "management",
            bridgeGroup: "management",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
        },
        {
          id: "node-a",
          name: "router-1",
          runtime: "qemu",
          templateId: "tmpl",
          imageId: null,
          position: { x: 100, y: 0 },
          config: { vcpu: 1, ramMb: 1024, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [
        { interfaceId: "if-cloud-0", networkId: "net-1" },
        { interfaceId: "if-a-0", networkId: "net-1" },
      ],
    };

    const commands: string[][] = [];
    const result = await ensureTapNetworking(
      document,
      async (command, args) => {
        commands.push([command, ...args]);
        return { ok: true, stdout: "", stderr: "" };
      },
      async () => true,
      undefined,
      async () => false,
    );

    expect(result.ok).toBe(true);
    expect(commands).not.toContainEqual([
      "ip",
      "link",
      "add",
      "name",
      "nc-br-net1",
      "type",
      "bridge",
    ]);
    expect(commands).toContainEqual([
      "ip",
      "link",
      "add",
      "name",
      "nc-mgmt",
      "type",
      "bridge",
    ]);
    expect(commands).toContainEqual([
      "ip",
      "link",
      "set",
      "dev",
      "tap-c123-odea-0",
      "master",
      "nc-mgmt",
    ]);
    expect(commands).not.toContainEqual([
      "ip",
      "link",
      "set",
      "dev",
      "nc-mgmt",
      "master",
      "nc-br-net1",
    ]);
  });

  it("bridges the host uplink into nc-mgmt in lan mode for management clouds", async () => {
    process.env.NETWORKCHUM_BIND_MODE = "lan";
    process.env.NETWORKCHUM_MANAGEMENT_UPLINK = "eno1";

    const document: LabDocument = {
      id: "lab-abc123",
      name: "Test Lab",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      annotations: [],
      startupConfigSets: [],
      nodeBootActions: [],
      activeConfigSetId: null,
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "cloud-a",
          name: "mgmt",
          runtime: "cloud",
          templateId: "cloud",
          imageId: null,
          position: { x: 0, y: 0 },
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 1,
            cloudRole: "management",
            bridgeGroup: "management",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
        },
        {
          id: "node-a",
          name: "router-1",
          runtime: "qemu",
          templateId: "tmpl",
          imageId: null,
          position: { x: 100, y: 0 },
          config: { vcpu: 1, ramMb: 1024, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [
        { interfaceId: "if-cloud-0", networkId: "net-1" },
        { interfaceId: "if-a-0", networkId: "net-1" },
      ],
    };

    const commands: string[][] = [];
    const result = await ensureTapNetworking(
      document,
      async (command, args) => {
        commands.push([command, ...args]);

        if (
          command === "ip" &&
          args.join(" ") === "-json link show dev nc-mgmt"
        ) {
          return {
            ok: true,
            stdout: JSON.stringify([
              { ifname: "nc-mgmt", address: "02:00:00:00:00:01" },
            ]),
            stderr: "",
          };
        }
        if (
          command === "ip" &&
          args.join(" ") === "-json addr show dev nc-mgmt"
        ) {
          return {
            ok: true,
            stdout: JSON.stringify([{ addr_info: [] }]),
            stderr: "",
          };
        }
        if (command === "ip" && args.join(" ") === "-json link show dev eno1") {
          return {
            ok: true,
            stdout: JSON.stringify([
              { ifname: "eno1", address: "aa:bb:cc:dd:ee:ff" },
            ]),
            stderr: "",
          };
        }
        if (command === "ip" && args.join(" ") === "-json addr show dev eno1") {
          return {
            ok: true,
            stdout: JSON.stringify([
              {
                addr_info: [
                  {
                    family: "inet",
                    local: "192.168.2.57",
                    prefixlen: 24,
                    scope: "global",
                  },
                ],
              },
            ]),
            stderr: "",
          };
        }
        if (command === "ip" && args.join(" ") === "-json route show default") {
          return {
            ok: true,
            stdout: JSON.stringify([
              { dst: "default", gateway: "192.168.2.254", dev: "eno1" },
            ]),
            stderr: "",
          };
        }

        return { ok: true, stdout: "", stderr: "" };
      },
      async () => true,
      undefined,
      async () => false,
    );

    expect(result.ok).toBe(true);
    expect(commands).toContainEqual([
      "ip",
      "link",
      "set",
      "dev",
      "eno1",
      "master",
      "nc-mgmt",
    ]);
    expect(commands).toContainEqual([
      "ip",
      "addr",
      "add",
      "192.168.2.57/24",
      "dev",
      "nc-mgmt",
    ]);
    expect(commands).toContainEqual([
      "ip",
      "route",
      "replace",
      "default",
      "via",
      "192.168.2.254",
      "dev",
      "nc-mgmt",
    ]);
  });

  it("fails when a private cloud-backed network has no bridge group", async () => {
    const document: LabDocument = {
      id: "lab-abc123",
      name: "Test Lab",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      annotations: [],
      startupConfigSets: [],
      nodeBootActions: [],
      activeConfigSetId: null,
      networks: [
        { id: "net-1", kind: "ethernet", name: "LAN", visible: false },
      ],
      nodes: [
        {
          id: "cloud-a",
          name: "mgmt",
          runtime: "cloud",
          templateId: "cloud",
          imageId: null,
          position: { x: 0, y: 0 },
          config: {
            vcpu: 0,
            ramMb: 0,
            interfaceCount: 1,
            cloudRole: "private-circuit",
          },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
        },
        {
          id: "node-a",
          name: "router-1",
          runtime: "qemu",
          templateId: "tmpl",
          imageId: null,
          position: { x: 100, y: 0 },
          config: { vcpu: 1, ramMb: 1024, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [
        { interfaceId: "if-cloud-0", networkId: "net-1" },
        { interfaceId: "if-a-0", networkId: "net-1" },
      ],
    };

    const result = await ensureTapNetworking(
      document,
      async () => ({ ok: true, stdout: "", stderr: "" }),
      async () => true,
      undefined,
      async () => false,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected cloud bridge-group validation to fail");
    }
    expect(result.message).toContain("bridge group");
  });

  it("chooses a serial base where both serial and monitor ports are free", async () => {
    const usedPorts = new Set([5000, 5001]);

    const basePort = await findAvailableQemuPortBase(
      5000,
      async (port) => !usedPorts.has(port),
    );

    expect(basePort).toBe(5002);
  });

  it("returns a real container-backed runtime state for container nodes", async () => {
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
      hasBinary: async (command) => command === "docker",
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

  it("uses the macos management backend for management clouds instead of the NAT helper", async () => {
    const platformSpy = vi.spyOn(os, "platform").mockReturnValue("darwin");
    try {
      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "networkchum-runtime-"),
      );
      tempDirs.push(tempDir);
      process.env.NETWORKCHUM_DATA_DIR = tempDir;

      const lab = await createLab("macos mgmt cloud backend lab");
      const document: LabDocument = {
        ...lab.document,
        networks: [
          { id: "net-1", kind: "ethernet", name: "Mgmt", visible: false },
        ],
        nodes: [
          {
            id: "cloud-a",
            name: "mgmt",
            runtime: "cloud",
            templateId: "cloud",
            imageId: null,
            position: { x: 0, y: 0 },
            config: {
              vcpu: 0,
              ramMb: 0,
              interfaceCount: 1,
              cloudRole: "management",
              bridgeGroup: "management",
            },
            state: { desiredPower: "off" },
            interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
          },
        ],
        attachments: [{ interfaceId: "if-cloud-0", networkId: "net-1" }],
      };
      await updateLabDocument(lab.id, document);

      const commands: string[][] = [];
      const state = await powerOnNode(lab.id, "cloud-a", {
        runCommand: async (command, args) => {
          commands.push([command, ...args]);
          if (command.includes("qemu") && args[0] === "-netdev") {
            return { ok: true, stdout: "vmnet-host\n", stderr: "" };
          }
          return { ok: true, stdout: "container-id-123", stderr: "" };
        },
        hasBinary: async (command) =>
          command === "docker" || command.includes("qemu"),
        resolveQemuBinary: async () => "/usr/bin/qemu-system-x86_64",
      });

      expect(state?.runtime).toBe("cloud");
      expect(
        commands.some((cmd) => cmd[0] === "docker" || cmd[0] === "podman"),
      ).toBe(false);
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("fails clearly when macos management backend is unavailable", async () => {
    const platformSpy = vi.spyOn(os, "platform").mockReturnValue("darwin");
    try {
      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "networkchum-runtime-"),
      );
      tempDirs.push(tempDir);
      process.env.NETWORKCHUM_DATA_DIR = tempDir;

      const lab = await createLab("macos mgmt cloud unavailable lab");
      const document: LabDocument = {
        ...lab.document,
        networks: [
          { id: "net-1", kind: "ethernet", name: "Mgmt", visible: false },
        ],
        nodes: [
          {
            id: "cloud-a",
            name: "mgmt",
            runtime: "cloud",
            templateId: "cloud",
            imageId: null,
            position: { x: 0, y: 0 },
            config: {
              vcpu: 0,
              ramMb: 0,
              interfaceCount: 1,
              cloudRole: "management",
              bridgeGroup: "management",
            },
            state: { desiredPower: "off" },
            interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
          },
        ],
        attachments: [{ interfaceId: "if-cloud-0", networkId: "net-1" }],
      };
      await updateLabDocument(lab.id, document);

      const state = await powerOnNode(lab.id, "cloud-a", {
        runCommand: async (command, args) => {
          if (command.includes("qemu") && args[0] === "-netdev") {
            return { ok: true, stdout: "socket\n", stderr: "" };
          }
          return { ok: true, stdout: "container-id-123", stderr: "" };
        },
        hasBinary: async (command) =>
          command === "docker" || command.includes("qemu"),
        resolveQemuBinary: async () => "/usr/bin/qemu-system-x86_64",
      });

      expect(state?.status).toBe("failed");
      expect(state?.message).toContain("host-only management backend");
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("assigns macos-management NIC backend for qemu interfaces attached to management cloud networks on macos", async () => {
    const platformSpy = vi.spyOn(os, "platform").mockReturnValue("darwin");
    try {
      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "networkchum-runtime-"),
      );
      tempDirs.push(tempDir);
      process.env.NETWORKCHUM_DATA_DIR = tempDir;

      const registry = new TemplateRegistry();
      const lab = await createLab("macos mgmt qemu nic backend lab");
      const template = registry.get("cisco-iosv")!;
      let document = addNode(lab.document, {
        template,
        name: "vm-1",
        position: { x: 100, y: 0 },
        imageId: "/tmp/vm.qcow2",
      });
      const nodeId = document.nodes[0]!.id;

      // Add a management cloud attached to net-mgmt, and attach NIC0 to it.
      document = {
        ...document,
        networks: [
          { id: "net-mgmt", kind: "ethernet", name: "Mgmt", visible: false },
          { id: "net-lan", kind: "ethernet", name: "LAN", visible: false },
        ],
        nodes: [
          ...document.nodes,
          {
            id: "cloud-a",
            name: "mgmt",
            runtime: "cloud",
            templateId: "cloud",
            imageId: null,
            position: { x: 0, y: 0 },
            config: {
              vcpu: 0,
              ramMb: 0,
              interfaceCount: 1,
              cloudRole: "management",
              bridgeGroup: "management",
            },
            state: { desiredPower: "off" },
            interfaces: [{ id: "if-cloud-0", name: "eth0", slot: 0 }],
          },
        ],
        attachments: [
          { interfaceId: "if-cloud-0", networkId: "net-mgmt" },
          // VM NIC0: management-backed
          {
            interfaceId: document.nodes[0]!.interfaces[0]!.id,
            networkId: "net-mgmt",
          },
          // VM NIC1: normal socket segment
          {
            interfaceId: document.nodes[0]!.interfaces[1]!.id,
            networkId: "net-lan",
          },
        ],
      };
      await updateLabDocument(lab.id, document);

      // powerOnNode() triggers syncSocketTopology() on success for socket backends.
      // Stub the virtual switch to avoid real TCP connection attempts.
      const resetSpy = vi
        .spyOn(virtualSwitch, "reset")
        .mockImplementation(() => {});
      const addNicSpy = vi
        .spyOn(virtualSwitch, "addNic")
        .mockImplementation(() => {});
      const syncAttachmentsSpy = vi
        .spyOn(virtualSwitch, "syncAttachments")
        .mockImplementation(() => {});

      const state = await powerOnNode(lab.id, nodeId, {
        runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
        hasBinary: async () => true,
        findAvailablePort: async (port) => port,
        launchQemu: async () => ({ ok: true, pid: 12345, stderr: "" }),
      });

      expect(state?.runtime).toBe("qemu");
      const qemuState = state as RuntimeState;

      expect(state?.status).toBe("running");
      // Template interfaceCount may exceed 2; powerOnNode() persists a null-filled
      // backend hint array with explicit management overrides.
      expect(qemuState.nicBackends).toEqual([
        "macos-management",
        null,
        null,
        null,
      ]);
      expect(qemuState.commandPreview.join(" ")).toContain(
        "vmnet-host,id=net0",
      );
      expect(qemuState.commandPreview.join(" ")).toContain(
        "socket,id=net1,listen=127.0.0.1:20001",
      );

      const savedStates = await listRuntimeStates(lab.id);
      const saved = savedStates.find((entry) => entry.nodeId === nodeId);
      expect(saved?.nicBackends).toEqual([
        "macos-management",
        null,
        null,
        null,
      ]);

      expect(resetSpy).toHaveBeenCalledTimes(1);
      // syncSocketTopology() should skip slot 0 (management-backed) but register
      // remaining NIC socket ports.
      expect(addNicSpy).toHaveBeenCalledTimes(3);
      expect(addNicSpy).toHaveBeenCalledWith(
        document.nodes[0]!.interfaces[1]!.id,
        20001,
      );
      expect(addNicSpy).toHaveBeenCalledWith(
        document.nodes[0]!.interfaces[2]!.id,
        20002,
      );
      expect(addNicSpy).toHaveBeenCalledWith(
        document.nodes[0]!.interfaces[3]!.id,
        20003,
      );
      expect(addNicSpy).not.toHaveBeenCalledWith(
        document.nodes[0]!.interfaces[0]!.id,
        20000,
      );
      expect(syncAttachmentsSpy).toHaveBeenCalledTimes(1);

      resetSpy.mockRestore();
      addNicSpy.mockRestore();
      syncAttachmentsSpy.mockRestore();
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("persists an explicit null-filled nicBackends array for macos socket launches without management NICs", async () => {
    const platformSpy = vi.spyOn(os, "platform").mockReturnValue("darwin");
    try {
      const tempDir = await mkdtemp(
        path.join(os.tmpdir(), "networkchum-runtime-"),
      );
      tempDirs.push(tempDir);
      process.env.NETWORKCHUM_DATA_DIR = tempDir;

      const registry = new TemplateRegistry();
      const lab = await createLab("macos socket-only backend lab");
      const template = registry.get("cisco-iosv")!;
      const document = addNode(lab.document, {
        template,
        name: "vm-1",
        position: { x: 0, y: 0 },
        imageId: "/tmp/vm.qcow2",
      });
      const nodeId = document.nodes[0]!.id;
      await updateLabDocument(lab.id, document);

      const state = await powerOnNode(lab.id, nodeId, {
        runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
        hasBinary: async () => true,
        findAvailablePort: async (port) => port,
        launchQemu: async () => ({ ok: true, pid: 12345, stderr: "" }),
      });

      expect(state?.status).toBe("running");
      const interfaceCount = document.nodes[0]!.config.interfaceCount;
      const expectedNullBackends = Array.from(
        { length: interfaceCount },
        () => null,
      );
      expect(state?.nicBackends).toEqual(expectedNullBackends);

      const savedStates = await listRuntimeStates(lab.id);
      const saved = savedStates.find((entry) => entry.nodeId === nodeId);
      expect(saved?.nicBackends).toEqual(expectedNullBackends);
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("clears inject-once boot action after launch attempt", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Inject Once Clear Lab");
    const template = registry.get("linux-alpine-container")!;
    let document = addNode(lab.document, {
      template,
      name: "inject-clear",
      position: { x: 10, y: 10 },
    });
    const nodeId = document.nodes[0]!.id;
    document = setNodeBootActions(document, nodeId, {
      startupConfig: "once",
      runningConfigBackup: "none",
    });
    await updateLabDocument(lab.id, document);

    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async (command, args) => {
        expect(command).toBe("docker");
        expect(args).toContain("run");
        return { ok: true, stdout: "container-id-123", stderr: "" };
      },
      hasBinary: async (command) => command === "docker",
    });

    expect(state?.status).toBe("running");
    const updatedLab = await getLab(lab.id);
    expect(updatedLab?.document.nodeBootActions).toEqual([]);
  });

  it("clears backup-once boot action after launch attempt", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Backup Once Clear Lab");
    const template = registry.get("linux-alpine-container")!;
    let document = addNode(lab.document, {
      template,
      name: "backup-clear",
      position: { x: 10, y: 10 },
    });
    const nodeId = document.nodes[0]!.id;
    document = setNodeBootActions(document, nodeId, {
      startupConfig: "none",
      runningConfigBackup: "once",
    });
    await updateLabDocument(lab.id, document);

    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async (_command, _args) => ({
        ok: true,
        stdout: "container-id-123",
        stderr: "",
      }),
      hasBinary: async () => true,
    });

    expect(state?.status).toBe("running");
    const updatedLab = await getLab(lab.id);
    expect(updatedLab?.document.nodeBootActions).toEqual([]);
  });

  it("schedules backup-once when boot action is set", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Backup Once Trigger Lab");
    const template = registry.get("linux-alpine-container")!;
    let document = addNode(lab.document, {
      template,
      name: "backup-call",
      position: { x: 10, y: 10 },
    });
    const nodeId = document.nodes[0]!.id;
    document = setNodeBootActions(document, nodeId, {
      startupConfig: "none",
      runningConfigBackup: "once",
    });
    await updateLabDocument(lab.id, document);

    const scheduleBackup = vi.fn(async () => undefined);
    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async (_command, _args) => ({
        ok: true,
        stdout: "container-id-123",
        stderr: "",
      }),
      hasBinary: async () => true,
      scheduleRunningConfigBackup: scheduleBackup,
    });

    expect(state?.status).toBe("running");
    expect(scheduleBackup).toHaveBeenCalledWith(
      expect.objectContaining({ labId: lab.id, nodeId }),
    );
    expect(scheduleBackup).toHaveBeenCalledTimes(1);
  });

  it("preserves always boot policies after launch attempt", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Always Boot Policy Lab");
    const template = registry.get("linux-alpine-container")!;
    let document = addNode(lab.document, {
      template,
      name: "always-policy",
      position: { x: 10, y: 10 },
    });
    const nodeId = document.nodes[0]!.id;
    document = setNodeBootActions(document, nodeId, {
      startupConfig: "always",
      runningConfigBackup: "always",
    });
    await updateLabDocument(lab.id, document);

    const scheduleBackup = vi.fn(async () => undefined);
    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async (_command, _args) => ({
        ok: true,
        stdout: "container-id-123",
        stderr: "",
      }),
      hasBinary: async () => true,
      scheduleRunningConfigBackup: scheduleBackup,
    });

    expect(state?.status).toBe("running");
    expect(scheduleBackup).toHaveBeenCalledTimes(1);
    const updatedLab = await getLab(lab.id);
    expect(updatedLab?.document.nodeBootActions).toEqual([
      expect.objectContaining({
        nodeId,
        startupConfig: "always",
        runningConfigBackup: "always",
      }),
    ]);
  });

  it("clears inject-once boot action even when startup config is blank", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Blank Config Inject Lab");
    const template = registry.get("linux-alpine-container")!;
    let document = addNode(lab.document, {
      template,
      name: "blank-config",
      position: { x: 10, y: 10 },
    });
    const nodeId = document.nodes[0]!.id;
    document = setNodeBootActions(document, nodeId, {
      startupConfig: "once",
      runningConfigBackup: "none",
    });
    document = {
      ...document,
      startupConfigSets: [
        {
          id: "set-blank",
          name: "Blank Config",
          nodeConfigs: [{ nodeId, config: "   \n   " }],
        },
      ],
      activeConfigSetId: "set-blank",
    };
    await updateLabDocument(lab.id, document);

    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async (command, args) => {
        expect(command).toBe("docker");
        expect(args).toContain("run");
        return { ok: true, stdout: "container-id-123", stderr: "" };
      },
      hasBinary: async (command) => command === "docker",
    });

    expect(state?.status).toBe("running");
    const updatedLab = await getLab(lab.id);
    expect(updatedLab?.document.nodeBootActions).toEqual([]);
  });

  it("returns failed state for qemu nodes when no qemu binary exists", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Qemu Lab");
    const template = registry.get("cisco-iosv")!;
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

  it("includes CSR1000v config-drive args in commandPreview when startup config is active", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const { restorePath, mcopyLogPath } = await installFakeCsrTools(tempDir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const registry = new TemplateRegistry();
      const lab = await createLab("CSR Qemu Lab");
      const template = registry.get("cisco-asr")!;
      let document = addNode(lab.document, {
        template,
        name: "csr-1",
        position: { x: 10, y: 10 },
        imageId: "/tmp/csr.qcow2",
      });
      const nodeId = document.nodes[0]!.id;
      document = setNodeBootActions(document, nodeId, {
        startupConfig: "once",
        runningConfigBackup: "none",
      });
      await updateLabDocument(lab.id, {
        ...document,
        startupConfigSets: [
          {
            id: "set-1",
            name: "Active Config",
            nodeConfigs: [{ nodeId, config: "hostname csr-1\n" }],
          },
        ],
        activeConfigSetId: "set-1",
      });

      const state = await powerOnNode(lab.id, nodeId, {
        runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
        hasBinary: async () => true,
        findAvailablePort: async (port) => port,
        launchQemu: async () => ({ ok: true, pid: 12345, stderr: "" }),
      });

      expect(state?.status).toBe("running");
      expect(state?.commandPreview).toContain("-drive");
      expect(state?.commandPreview).toContain(
        `file=${tempDir}/configs/${lab.id}/${nodeId}-startup.img,if=virtio,format=raw`,
      );
      await expect(readFile(mcopyLogPath, "utf8")).resolves.toContain(
        "::iosxe_config.txt",
      );
      expect(logSpy).toHaveBeenCalledWith(
        `[powerNode] selected CSR1000v config-drive layout=csr1000v-vfat artifact=${tempDir}/configs/${lab.id}/${nodeId}-startup.img`,
      );
    } finally {
      logSpy.mockRestore();
      restorePath();
    }
  });

  it("skips CSR config injection when startup config is whitespace even with inject-once", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const { restorePath } = await installFakeCsrTools(tempDir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const registry = new TemplateRegistry();
      const lab = await createLab("CSR Blank Config Lab");
      const template = registry.get("cisco-asr")!;
      let document = addNode(lab.document, {
        template,
        name: "csr-blank",
        position: { x: 10, y: 10 },
        imageId: "/tmp/csr.qcow2",
      });
      const nodeId = document.nodes[0]!.id;
      document = setNodeBootActions(document, nodeId, {
        startupConfig: "once",
        runningConfigBackup: "none",
      });
      await updateLabDocument(lab.id, {
        ...document,
        startupConfigSets: [
          {
            id: "set-blank",
            name: "Blank Config",
            nodeConfigs: [{ nodeId, config: "   \n  " }],
          },
        ],
        activeConfigSetId: "set-blank",
      });

      const state = await powerOnNode(lab.id, nodeId, {
        runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
        hasBinary: async () => true,
        findAvailablePort: async (port) => port,
        launchQemu: async () => ({ ok: true, pid: 12345, stderr: "" }),
      });

      const hasStartupDrive = (state?.commandPreview ?? []).some(
        (arg) =>
          typeof arg === "string" &&
          arg.includes(`${tempDir}/configs/${lab.id}/${nodeId}-startup.img`),
      );
      expect(hasStartupDrive).toBe(false);
      expect(
        logSpy.mock.calls.some(([msg]) =>
          typeof msg === "string"
            ? msg.includes("CSR1000v config-drive layout")
            : false,
        ),
      ).toBe(false);
    } finally {
      logSpy.mockRestore();
      restorePath();
    }
  });

  it("skips CSR1000v config-drive and overlay reset when a startup config exists but no boot action", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const { restorePath } = await installFakeCsrTools(tempDir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const registry = new TemplateRegistry();
      const lab = await createLab("CSR Boot Action Lab");
      const template = registry.get("cisco-asr")!;
      let document = addNode(lab.document, {
        template,
        name: "csr-1",
        position: { x: 10, y: 10 },
        imageId: "/tmp/csr.qcow2",
      });
      const nodeId = document.nodes[0]!.id;
      await updateLabDocument(lab.id, {
        ...document,
        startupConfigSets: [
          {
            id: "set-1",
            name: "Active Config",
            nodeConfigs: [{ nodeId, config: "hostname csr-1\n" }],
          },
        ],
        activeConfigSetId: "set-1",
      });

      const state = await powerOnNode(lab.id, nodeId, {
        runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
        hasBinary: async () => true,
        findAvailablePort: async (port) => port,
        launchQemu: async () => ({ ok: true, pid: 12345, stderr: "" }),
      });

      const previewArgs = state?.commandPreview ?? [];
      expect(
        previewArgs.some(
          (arg) =>
            typeof arg === "string" &&
            arg.includes(`${tempDir}/configs/${lab.id}/${nodeId}-startup.img`),
        ),
      ).toBe(false);
      expect(
        previewArgs.some(
          (arg) =>
            typeof arg === "string" &&
            arg.includes("if=virtio,format=raw") &&
            arg.includes("csr1000v-vfat"),
        ),
      ).toBe(false);
      expect(
        logSpy.mock.calls.some(([msg]) =>
          typeof msg === "string"
            ? msg.includes("resetting overlay for day-0 config injection")
            : false,
        ),
      ).toBe(false);
      expect(
        logSpy.mock.calls.some(([msg]) =>
          typeof msg === "string"
            ? msg.includes("CSR1000v config-drive layout")
            : false,
        ),
      ).toBe(false);
    } finally {
      logSpy.mockRestore();
      restorePath();
    }
  });

  it("injects CSR1000v config-drive when boot action includes inject-once", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const { restorePath, mcopyLogPath } = await installFakeCsrTools(tempDir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const registry = new TemplateRegistry();
      const lab = await createLab("CSR Boot Action Inject Lab");
      const template = registry.get("cisco-asr")!;
      let document = addNode(lab.document, {
        template,
        name: "csr-1",
        position: { x: 10, y: 10 },
        imageId: "/tmp/csr.qcow2",
      });
      const nodeId = document.nodes[0]!.id;
      document = setNodeBootActions(document, nodeId, {
        startupConfig: "once",
        runningConfigBackup: "none",
      });
      await updateLabDocument(lab.id, {
        ...document,
        startupConfigSets: [
          {
            id: "set-1",
            name: "Active Config",
            nodeConfigs: [{ nodeId, config: "hostname csr-1\n" }],
          },
        ],
        activeConfigSetId: "set-1",
      });

      const state = await powerOnNode(lab.id, nodeId, {
        runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
        hasBinary: async () => true,
        findAvailablePort: async (port) => port,
        launchQemu: async () => ({ ok: true, pid: 12345, stderr: "" }),
      });

      expect(state?.status).toBe("running");
      expect(state?.commandPreview).toContain(
        `file=${tempDir}/configs/${lab.id}/${nodeId}-startup.img,if=virtio,format=raw`,
      );
      await expect(readFile(mcopyLogPath, "utf8")).resolves.toContain(
        "::iosxe_config.txt",
      );
      expect(logSpy).toHaveBeenCalledWith(
        `[powerNode] selected CSR1000v config-drive layout=csr1000v-vfat artifact=${tempDir}/configs/${lab.id}/${nodeId}-startup.img`,
      );
    } finally {
      logSpy.mockRestore();
      restorePath();
    }
  });

  it("does not attach CSR1000v config-drive args when the active set has no config for the node", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const { restorePath } = await installFakeCsrTools(tempDir);
    try {
      const registry = new TemplateRegistry();
      const lab = await createLab("CSR Qemu Lab Without Config");
      const template = registry.get("cisco-asr")!;
      let document = addNode(lab.document, {
        template,
        name: "csr-1",
        position: { x: 10, y: 10 },
        imageId: "/tmp/csr.qcow2",
      });
      const nodeId = document.nodes[0]!.id;
      document = setNodeBootActions(document, nodeId, {
        startupConfig: "once",
        runningConfigBackup: "none",
      });
      await updateLabDocument(lab.id, {
        ...document,
        startupConfigSets: [
          {
            id: "set-1",
            name: "Active Config",
            nodeConfigs: [
              { nodeId: "some-other-node", config: "hostname other\n" },
            ],
          },
        ],
        activeConfigSetId: "set-1",
      });

      const state = await powerOnNode(lab.id, nodeId, {
        runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
        hasBinary: async () => true,
        findAvailablePort: async (port) => port,
        launchQemu: async () => ({ ok: true, pid: 12345, stderr: "" }),
      });

      expect(state?.status).toBe("running");
      expect(state?.commandPreview.join(" ")).not.toContain(
        `${tempDir}/configs/${lab.id}/${nodeId}-startup.img`,
      );
      expect(state?.commandPreview.join(" ")).not.toContain(
        "if=virtio,format=raw",
      );
    } finally {
      restorePath();
    }
  });

  it("gates IOSv day-0 drive on inject-once boot action", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const runScenario = async (withBootAction: boolean) => {
      const registry = new TemplateRegistry();
      const lab = await createLab(
        withBootAction ? "IOSv Boot Action Lab" : "IOSv No Boot Action Lab",
      );
      const template = registry.get("cisco-iosv")!;
      let document = addNode(lab.document, {
        template,
        name: `iosv-${withBootAction ? "action" : "default"}`,
        position: { x: 10, y: 10 },
        imageId: "/tmp/iosv.qcow2",
      });
      const nodeId = document.nodes[0]!.id;
      if (withBootAction) {
        document = setNodeBootActions(document, nodeId, {
          startupConfig: "once",
          runningConfigBackup: "none",
        });
      }
      await updateLabDocument(lab.id, {
        ...document,
        startupConfigSets: [
          {
            id: "set-1",
            name: "Active Config",
            nodeConfigs: [{ nodeId, config: "hostname iosv\n" }],
          },
        ],
        activeConfigSetId: "set-1",
      });

      const state = await powerOnNode(lab.id, nodeId, {
        runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
        hasBinary: async () => true,
        findAvailablePort: async (port) => port,
        launchQemu: async () => ({ ok: true, pid: 12345, stderr: "" }),
      });

      return { state, lab, nodeId };
    };

    const withoutAction = await runScenario(false);
    expect(
      (withoutAction.state?.commandPreview ?? []).some(
        (arg) =>
          typeof arg === "string" &&
          arg.includes(
            `${tempDir}/configs/${withoutAction.lab.id}/${withoutAction.nodeId}-startup.img`,
          ),
      ),
    ).toBe(false);

    const withAction = await runScenario(true);
    expect(
      (withAction.state?.commandPreview ?? []).some(
        (arg) =>
          typeof arg === "string" &&
          arg.includes(
            `${tempDir}/configs/${withAction.lab.id}/${withAction.nodeId}-startup.img`,
          ),
      ),
    ).toBe(true);
  });

  it("persists and logs exact CSR1000v commandPreview in runtime state when startup config is active", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const { restorePath, mcopyLogPath } = await installFakeCsrTools(tempDir);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const registry = new TemplateRegistry();
      const lab = await createLab("CSR Qemu Diagnostics Lab");
      const template = registry.get("cisco-asr")!;
      let document = addNode(lab.document, {
        template,
        name: "csr-1",
        position: { x: 10, y: 10 },
        imageId: "/tmp/csr.qcow2",
      });
      const nodeId = document.nodes[0]!.id;
      document = setNodeBootActions(document, nodeId, {
        startupConfig: "once",
        runningConfigBackup: "none",
      });
      await updateLabDocument(lab.id, {
        ...document,
        startupConfigSets: [
          {
            id: "set-1",
            name: "Active Config",
            nodeConfigs: [{ nodeId, config: "hostname csr-1\n" }],
          },
        ],
        activeConfigSetId: "set-1",
      });

      const state = await powerOnNode(lab.id, nodeId, {
        runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
        hasBinary: async () => true,
        findAvailablePort: async (port) => port,
        launchQemu: async () => ({ ok: true, pid: 12345, stderr: "" }),
      });

      const persistedState = (await listRuntimeStates(lab.id)).find(
        (runtimeState) => runtimeState.nodeId === nodeId,
      );

      expect(state?.status).toBe("running");
      expect(state?.commandPreview).toBeDefined();
      expect(persistedState?.commandPreview).toEqual(state?.commandPreview);
      expect(persistedState?.commandPreview.join(" ")).toContain(
        `${tempDir}/configs/${lab.id}/${nodeId}-startup.img`,
      );
      expect(persistedState?.commandPreview.join(" ")).toContain(
        "if=virtio,format=raw",
      );
      await expect(readFile(mcopyLogPath, "utf8")).resolves.toContain(
        "::iosxe_config.txt",
      );
      expect(logSpy).toHaveBeenCalledWith(
        `[powerNode] QEMU command preview: ${state!.commandPreview.join(" ")}`,
      );
    } finally {
      logSpy.mockRestore();
      restorePath();
    }
  });

  it("returns running state with serial console for qemu nodes when binary exists", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Qemu Live Lab");
    const template = registry.get("cisco-iosv")!;
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

  it("falls back to the distro qemu binary when qemu-system-x86_64 is unavailable", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Qemu Fallback Binary Lab");
    const template = registry.get("cisco-iosv")!;
    const document = addNode(lab.document, {
      template,
      name: "vm-fallback",
      position: { x: 10, y: 10 },
      imageId: "/tmp/vm.qcow2",
    });
    await updateLabDocument(lab.id, document);
    const savedLab = await getLab(lab.id);
    const nodeId = savedLab!.document.nodes[0]!.id;

    let launchedBinary = "";
    const state = await powerOnNode(lab.id, nodeId, {
      runCommand: async () => ({ ok: true, stdout: "", stderr: "" }),
      hasBinary: async (command) => command === "/usr/libexec/qemu-kvm",
      findAvailablePort: async (port) => port,
      launchQemu: async (command) => {
        launchedBinary = command[0] ?? "";
        return { ok: true, pid: 12345, stderr: "" };
      },
    });

    expect(state?.status).toBe("running");
    expect(launchedBinary).toBe("/usr/libexec/qemu-kvm");
    expect(state?.commandPreview[0]).toBe("/usr/libexec/qemu-kvm");
  });

  it("returns failed state when qemu launch fails", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Qemu Fail Lab");
    const template = registry.get("cisco-iosv")!;
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
    const template = registry.get("cisco-iosv")!;
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
      runCommand: async (command, args) => {
        if (command === "ps" && args[0] === "-p" && args[1] === "99999") {
          return {
            ok: true,
            stdout:
              "qemu-system-x86_64 -serial tcp:127.0.0.1:5004,server,nowait\n",
            stderr: "",
          };
        }

        return { ok: true, stdout: "", stderr: "" };
      },
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

  it("does not detach a pre-existing host bridge when powering off a cloud node", async () => {
    const tempDir = await mkdtemp(
      path.join(os.tmpdir(), "networkchum-runtime-"),
    );
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    const registry = new TemplateRegistry();
    const lab = await createLab("Cloud Poweroff Lab");
    const template = registry.get("cloud")!;
    const document = addNode(lab.document, {
      template,
      name: "mgmt",
      position: { x: 10, y: 10 },
      bridgeInterface: "br-mgmt",
    });
    await updateLabDocument(lab.id, document);
    const savedLab = await getLab(lab.id);
    const nodeId = savedLab!.document.nodes[0]!.id;

    await upsertRuntimeState({
      labId: lab.id,
      nodeId,
      status: "running",
      runtime: "cloud",
      accelerationMode: null,
      externalId: "cloud-tap",
      commandPreview: [],
      updatedAt: new Date().toISOString(),
    });

    const runCommand = vi
      .fn()
      .mockResolvedValue({ ok: true, stdout: "", stderr: "" });

    await powerOffNode(lab.id, nodeId, {
      runCommand,
      isBridgeInterface: async (interfaceName) => interfaceName === "br-mgmt",
    });

    expect(runCommand).not.toHaveBeenCalledWith("ip", [
      "link",
      "set",
      "dev",
      "br-mgmt",
      "nomaster",
    ]);
  });
});
