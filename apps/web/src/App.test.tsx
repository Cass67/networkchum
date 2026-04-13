import "./setupCanvasMock";
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NodeBootActionState } from "@networkchum/shared";
import { App } from "./App.js";
afterEach(() => {
  cleanup();
});

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
  });
  document.documentElement.removeAttribute("data-theme");
});

describe("App", () => {
  it("renders the shell", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "NetworkChum" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Labs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Devices" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to day mode" }),
    ).toBeInTheDocument();
  });

  it("uses dedicated scroll containers for the side panels", () => {
    render(<App />);

    const shell = document.querySelector(".app-shell");
    const leftSidebar = document.querySelector(".left-sidebar");
    const sidebarContent = document.querySelector(".sidebar-content");
    const rightPanel = document.querySelector(".right-panel");

    expect(shell).not.toBeNull();
    expect(leftSidebar).not.toBeNull();
    expect(sidebarContent).not.toBeNull();
    expect(rightPanel).not.toBeNull();

    expect(getComputedStyle(shell!).overflow).toBe("hidden");
    expect(getComputedStyle(leftSidebar!).display).toBe("flex");
    expect(getComputedStyle(leftSidebar!).minHeight).toBe("0px");
    expect(getComputedStyle(sidebarContent!).flexGrow).toBe("1");
    expect(getComputedStyle(sidebarContent!).minHeight).toBe("0px");
    expect(getComputedStyle(sidebarContent!).overflowY).toBe("auto");
    expect(getComputedStyle(rightPanel!).minHeight).toBe("0px");
    expect(getComputedStyle(rightPanel!).overflowY).toBe("auto");
  });

  it("loads labs and catalog from the api client", async () => {
    const api = {
      listLabs: async () => [
        { id: "lab-9", name: "Fetched Lab" },
        { id: "lab-10", name: "Second Lab" },
      ],
      listCatalog: async () => [
        { id: "entry-1", name: "Fetched Device", source: "image-bound" },
      ],
      createLab: async () => ({ id: "lab-10", name: "New Lab" }),
      getLab: async (labId: string) => ({
        id: labId,
        name: labId === "lab-10" ? "Second Lab" : "Fetched Lab",
        document: {
          nodes:
            labId === "lab-10"
              ? [
                  {
                    id: "node-9",
                    name: "second-node",
                    position: { x: 300, y: 180 },
                  },
                ]
              : [],
          networks: [],
          attachments: [],
        },
      }),
      addNode: async (
        _labId: string,
        input: {
          templateId: string;
          name: string;
          position: { x: number; y: number };
        },
      ) => ({
        id: "lab-9",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: input.name, position: { x: 120, y: 80 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [],
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    render(<App api={api} />);

    await waitFor(() => {
      expect(screen.getAllByText("Fetched Lab").length).toBeGreaterThan(0);
      expect(screen.getByText("Empty canvas")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Second Lab" }));

    await waitFor(() => {
      expect(screen.getAllByText("second-node").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));

    await waitFor(() => {
      expect(screen.getByText("Fetched Device")).toBeInTheDocument();
    });

    const addNodeButtons = screen.getAllByRole("button", {
      name: "Add Fetched Device",
    });
    fireEvent.click(addNodeButtons[addNodeButtons.length - 1]!);

    await screen.findByTestId("add-node-dialog-overlay");
    fireEvent.change(screen.getByTestId("node-name-input"), {
      target: { value: "alpine-2" },
    });
    fireEvent.click(screen.getByTestId("add-node-submit"));

    await waitFor(() => {
      expect(screen.getAllByText("alpine-2").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Power On alpine-2" }));

    await waitFor(() => {
      expect(screen.getAllByText("running").length).toBeGreaterThan(0);
    });

    expect(
      screen.getByRole("button", { name: "Connect alpine-2" }),
    ).toBeInTheDocument();
  });

  it("shows a newly created lab on the canvas", async () => {
    const api = {
      listLabs: async () => [],
      listCatalog: async () => [
        { id: "entry-1", name: "Fetched Device", source: "image-bound" },
      ],
      createLab: async () => ({ id: "lab-20", name: "New Lab" }),
      getLab: async (labId: string) => ({
        id: labId,
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-20",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    render(<App api={api} />);

    fireEvent.click(screen.getByRole("button", { name: "Create Lab" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Delete Lab" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Canvas")).toBeInTheDocument();
    });
  });

  it("shows running-config backup summary for a focused node", async () => {
    const listRunningConfigBackups = vi.fn(async () => [
      {
        id: "backup-1",
        labId: "lab-backup",
        nodeId: "node-backup",
        status: "captured" as const,
        source: "Boot backup",
        createdAt: "2026-04-12T00:00:00.000Z",
      },
    ]);

    const api = {
      listLabs: async () => [{ id: "lab-backup", name: "Backup Lab" }],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-backup",
        name: "Backup Lab",
        document: {
          nodes: [
            {
              id: "node-backup",
              name: "Backup Node",
              position: { x: 10, y: 10 },
            },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-backup",
        name: "Backup Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-backup",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
      listRunningConfigBackups,
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Open Backup Lab" });
    fireEvent.click(screen.getByRole("button", { name: "Open Backup Lab" }));

    await waitFor(() => {
      expect(screen.getByTestId("node-node-backup")).toBeInTheDocument();
    });

    const node = screen.getByTestId("node-node-backup");
    fireEvent.mouseDown(node);
    fireEvent.click(node);

    await waitFor(() => {
      expect(listRunningConfigBackups).toHaveBeenCalledWith(
        "lab-backup",
        "node-backup",
      );
      expect(screen.getByText("Boot backup")).toBeInTheDocument();
      expect(screen.getByText(/captured/i)).toBeInTheDocument();
    });
  });

  it("renames the selected lab from the inspector", async () => {
    const renameLab = vi.fn(async (labId: string, name: string) => ({
      id: labId,
      name,
      document: { nodes: [], networks: [], attachments: [] },
    }));

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "entry-1", name: "Fetched Device", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      renameLab,
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Delete Lab" });

    fireEvent.change(screen.getByLabelText("Lab name"), {
      target: { value: "Edge Lab" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Name" }));

    await waitFor(() => {
      expect(renameLab).toHaveBeenCalledWith("lab-1", "Edge Lab");
      expect(screen.getAllByText("Edge Lab").length).toBeGreaterThan(0);
    });
  });

  it("toggles auto backup for the selected lab", async () => {
    const setLabAutoBackup = vi.fn(
      async (labId: string, autoBackup: boolean) => ({
        id: labId,
        name: "Fetched Lab",
        autoBackup,
        document: { nodes: [], networks: [], attachments: [] },
      }),
    );

    const api = {
      listLabs: async () => [
        { id: "lab-1", name: "Fetched Lab", autoBackup: false },
      ],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({
        id: "lab-2",
        name: "New Lab",
        autoBackup: false,
      }),
      renameLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        autoBackup: false,
        document: { nodes: [], networks: [], attachments: [] },
      }),
      setLabAutoBackup,
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        autoBackup: false,
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        autoBackup: false,
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Delete Lab" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Auto Backup" }));

    await waitFor(() => {
      expect(setLabAutoBackup).toHaveBeenCalledWith("lab-1", true);
      expect(
        screen.getByRole("checkbox", { name: "Auto Backup" }),
      ).toBeChecked();
    });
  });

  it("edits template defaults from the devices tab", async () => {
    const updateTemplate = vi.fn(
      async (
        _templateId: string,
        input: { vcpu: number; ramMb: number; interfaceCount: number },
      ) => ({
        id: "cisco-vios",
        name: "Cisco vIOS Router",
        vendor: "Cisco",
        runtime: "qemu",
        configSchema: {
          ramMb: { default: input.ramMb, min: 512, max: 4096 },
          vcpu: { default: input.vcpu, min: 1, max: 4 },
          interfaceCount: { default: input.interfaceCount, min: 1, max: 16 },
        },
      }),
    );

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        {
          id: "cisco-vios",
          name: "Cisco vIOS Router",
          source: "built-in",
          vendor: "Cisco",
          runtime: "qemu",
          configSchema: {
            ramMb: { default: 1024, min: 512, max: 4096 },
            vcpu: { default: 1, min: 1, max: 4 },
            interfaceCount: { default: 4, min: 1, max: 16 },
          },
        },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
      updateTemplate,
    };

    render(<App api={api} />);

    fireEvent.click(screen.getByRole("button", { name: "Devices" }));

    await screen.findByText("1 vCPU • 1024 MB RAM • 4 interfaces");

    fireEvent.click(
      screen.getByRole("button", { name: "Edit Cisco vIOS Router" }),
    );
    fireEvent.change(screen.getByLabelText("vCPU"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("RAM (MB)"), {
      target: { value: "4096" },
    });
    fireEvent.change(screen.getByLabelText("Interfaces"), {
      target: { value: "6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));

    await waitFor(() => {
      expect(updateTemplate).toHaveBeenCalledWith("cisco-vios", {
        vcpu: 4,
        ramMb: 4096,
        interfaceCount: 6,
      });
      expect(
        screen.getByText("4 vCPU • 4096 MB RAM • 6 interfaces"),
      ).toBeInTheDocument();
    });
  });

  it("does not request the hardcoded demo lab when the backend starts with no labs", async () => {
    const getLab = vi.fn(async (labId: string) => ({
      id: labId,
      name: "New Lab",
      document: { nodes: [], networks: [], attachments: [] },
    }));

    const api = {
      listLabs: async () => [],
      listCatalog: async () => [
        { id: "entry-1", name: "Fetched Device", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-20", name: "New Lab" }),
      getLab,
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-20",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    render(<App api={api} />);

    await waitFor(() => {
      expect(getLab).not.toHaveBeenCalledWith("lab-1");
    });
  });

  it("shows a create-lab error when the request fails", async () => {
    const api = {
      listLabs: async () => [{ id: "lab-9", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "entry-1", name: "Fetched Device", source: "image-bound" },
      ],
      createLab: async () => {
        throw new Error("backend unavailable");
      },
      getLab: async () => ({
        id: "lab-9",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-9",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    render(<App api={api} />);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Create Lab" }).at(-1)!,
    );

    await waitFor(() => {
      expect(screen.getByText("Failed to create lab")).toBeInTheDocument();
    });
  });

  it("requires confirmation before deleting a lab", async () => {
    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        {
          id: "linux-alpine-container",
          name: "Alpine Container",
          source: "built-in",
        },
      ],
      listImages: async () => [],
      listRuntimeStates: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      deleteLab: async () => ({ labId: "lab-1" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      deleteNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      deleteCable: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
      powerOffNode: async () => ({ nodeId: "node-1", status: "stopped" }),
      uploadImage: async () => ({
        id: "img-1",
        name: "csr1000v.qcow2",
        templateId: null,
        suggestedTemplateId: null,
        source: "upload",
        catalogState: "active",
      }),
      bindImageToTemplate: async () => ({
        id: "img-1",
        name: "csr1000v.qcow2",
        templateId: "cisco-asr",
        suggestedTemplateId: "cisco-asr",
        source: "upload",
        catalogState: "active",
      }),
      unbindImageFromTemplate: async () => ({
        id: "img-1",
        name: "csr1000v.qcow2",
        templateId: null,
        suggestedTemplateId: "cisco-asr",
        source: "upload",
        catalogState: "active",
      }),
      removeImageFromCatalog: async () => ({
        id: "img-1",
        name: "csr1000v.qcow2",
        templateId: null,
        suggestedTemplateId: "cisco-asr",
        source: "upload",
        catalogState: "removed",
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Delete Lab" });

    fireEvent.click(screen.getByRole("button", { name: "Delete Lab" }));

    expect(
      screen.getByRole("dialog", { name: "Delete Lab" }),
    ).toBeInTheDocument();
  });

  it("lists backups from the lab context menu and opens restore confirmation", async () => {
    const fetchSpy = vi.fn(async (input: string) => {
      if (input === "http://127.0.0.1:4010/health") {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal("fetch", fetchSpy);

    const api = {
      listLabs: async () => [
        { id: "lab-1", name: "Fetched Lab", autoBackup: true },
      ],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({
        id: "lab-2",
        name: "New Lab",
        autoBackup: false,
      }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        autoBackup: true,
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      listLabBackups: async () => [{ fileName: "2026-04-11T14-20-05Z.json" }],
      restoreLabBackup: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        autoBackup: true,
        document: { nodes: [], networks: [], attachments: [] },
      }),
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        autoBackup: true,
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Open Fetched Lab" });
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Open Fetched Lab" }),
      { clientX: 40, clientY: 40 },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "List Backups" }));

    expect(
      await screen.findByRole("dialog", { name: "Lab Backups" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Restore 2026-04-11T14-20-05Z.json" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Restore Backup" }),
    ).toBeInTheDocument();
  });

  it("refreshes runtime state from the backend when the window regains focus", async () => {
    let runtimeCallCount = 0;
    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => {
        runtimeCallCount += 1;
        return runtimeCallCount > 1
          ? [
              {
                nodeId: "node-1",
                status: "running",
                connectCommand: ["telnet", "127.0.0.1", "5004"],
                message: null,
              },
            ]
          : [];
      },
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Power On Arista-Veos-1" });

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(screen.getAllByText("running").length).toBeGreaterThan(0);
      expect(
        screen.getByRole("button", { name: "Open Console" }),
      ).toBeInTheDocument();
    });
  });

  it("uses the web console on double-click when preference is web console", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Open Console" });
    fireEvent.doubleClick(screen.getByTestId("node-node-1"));

    expect(openSpy).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("calls the native console bridge when preference is open in Terminal", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchSpy);
    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Open Console" });
    fireEvent.change(screen.getByLabelText("Native Console Preference"), {
      target: { value: "iterm-helper" },
    });
    fireEvent.doubleClick(screen.getByTestId("node-node-1"));

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/open-console",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminal: "iterm",
          host: "127.0.0.1",
          port: 5004,
        }),
      }),
    );
  });

  it("copies the native telnet command on double-click when preference is copy command", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Open Console" });
    fireEvent.change(screen.getByLabelText("Native Console Preference"), {
      target: { value: "copy-command" },
    });
    fireEvent.doubleClick(screen.getByTestId("node-node-1"));

    expect(writeText).toHaveBeenCalledWith(
      "socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004",
    );
  });

  it("copies an ssh-wrapped native telnet command on remote hosts", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(
      <App
        api={api}
        locationLike={{ protocol: "http:", hostname: "192.168.2.57" }}
      />,
    );

    await screen.findByRole("button", { name: "Open Console" });
    fireEvent.change(screen.getByLabelText("Native Console Preference"), {
      target: { value: "copy-command" },
    });
    fireEvent.doubleClick(screen.getByTestId("node-node-1"));

    expect(writeText).toHaveBeenCalledWith(
      "ssh -t 192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
    );
  });

  it("copies an ssh-wrapped native telnet command with the configured ssh relay user", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(
      <App
        api={api}
        locationLike={{ protocol: "http:", hostname: "192.168.2.57" }}
      />,
    );

    await screen.findByRole("button", { name: "Open Console" });
    fireEvent.change(screen.getByLabelText("SSH Relay User"), {
      target: { value: "cass" },
    });
    fireEvent.change(screen.getByLabelText("Native Console Preference"), {
      target: { value: "copy-command" },
    });
    fireEvent.doubleClick(screen.getByTestId("node-node-1"));

    expect(writeText).toHaveBeenCalledWith(
      "ssh -t cass@192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
    );
  });

  it("calls the client-local native console bridge on remote hosts", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(
      <App
        api={api}
        locationLike={{ protocol: "http:", hostname: "192.168.2.57" }}
      />,
    );

    await screen.findByRole("button", { name: "Open Console" });
    fireEvent.change(screen.getByLabelText("Native Console Preference"), {
      target: { value: "iterm-helper" },
    });
    fireEvent.doubleClick(screen.getByTestId("node-node-1"));

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/open-console",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminal: "iterm",
          host: "127.0.0.1",
          port: 5004,
          relayHost: "192.168.2.57",
        }),
      }),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it("passes the configured ssh relay user to the client-local native console bridge on remote hosts", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(
      <App
        api={api}
        locationLike={{ protocol: "http:", hostname: "192.168.2.57" }}
      />,
    );

    await screen.findByRole("button", { name: "Open Console" });
    fireEvent.change(screen.getByLabelText("SSH Relay User"), {
      target: { value: "cass" },
    });
    fireEvent.change(screen.getByLabelText("Native Console Preference"), {
      target: { value: "iterm-helper" },
    });
    fireEvent.doubleClick(screen.getByTestId("node-node-1"));

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:4010/open-console",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          terminal: "iterm",
          host: "127.0.0.1",
          port: 5004,
          relayHost: "192.168.2.57",
          relayUser: "cass",
        }),
      }),
    );
    expect(writeText).not.toHaveBeenCalled();
  });

  it("shows the telnet port in the selection sidebar for a running telnet-backed node", async () => {
    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Open Console" });

    expect(await screen.findByText("Console Port: 5004")).toBeInTheDocument();
  });

  it("copies the native telnet command for a telnet-backed node", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Copy Native Command" });
    fireEvent.click(
      screen.getByRole("button", { name: "Copy Native Command" }),
    );

    expect(writeText).toHaveBeenCalledWith(
      "socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004",
    );
  });

  it("copies an ssh-wrapped native telnet command for a remote telnet-backed node", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(
      <App
        api={api}
        locationLike={{ protocol: "http:", hostname: "192.168.2.57" }}
      />,
    );

    await screen.findByRole("button", { name: "Copy Native Command" });
    fireEvent.click(
      screen.getByRole("button", { name: "Copy Native Command" }),
    );

    expect(writeText).toHaveBeenCalledWith(
      "ssh -t 192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
    );
  });

  it("falls back to a prompt when clipboard write is blocked on a remote page", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("clipboard blocked");
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(
      <App
        api={api}
        locationLike={{ protocol: "http:", hostname: "192.168.2.57" }}
      />,
    );

    await screen.findByRole("button", { name: "Copy Native Command" });
    fireEvent.click(
      screen.getByRole("button", { name: "Copy Native Command" }),
    );

    expect(writeText).toHaveBeenCalledWith(
      "ssh -t 192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
    );
    await waitFor(() => {
      expect(promptSpy).toHaveBeenCalledWith(
        "Clipboard access is unavailable. Copy this command manually:",
        "ssh -t 192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
      );
    });
  });

  it("falls back to a prompt when the remote page cannot reach the client-local bridge and clipboard access is blocked", async () => {
    const fetchSpy = vi.fn(async (input: string) => {
      if (input === "http://127.0.0.1:4010/health") {
        return { ok: false, json: async () => ({ ok: false }) };
      }

      throw new Error("bridge offline");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const writeText = vi.fn(async () => {
      throw new Error("clipboard blocked");
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          message: null,
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(
      <App
        api={api}
        locationLike={{ protocol: "http:", hostname: "192.168.2.57" }}
      />,
    );

    await screen.findByRole("button", { name: "Open Console" });
    fireEvent.change(screen.getByLabelText("Native Console Preference"), {
      target: { value: "iterm-helper" },
    });
    fireEvent.doubleClick(screen.getByTestId("node-node-1"));

    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:4010/health");
    await waitFor(() => {
      expect(promptSpy).toHaveBeenCalledWith(
        "Clipboard access is unavailable. Copy this command manually:",
        "ssh -t 192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
      );
    });
  });

  it("remembers the selected theme across remounts", async () => {
    const api = {
      listLabs: async () => [],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-1", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    const { unmount } = render(<App api={api} />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    fireEvent.click(screen.getByRole("button", { name: "Switch to day mode" }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(window.localStorage.getItem("networkchum-theme")).toBe("light");
    });

    unmount();
    render(<App api={api} />);

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "light");
      expect(
        screen.getByRole("button", { name: "Switch to night mode" }),
      ).toBeInTheDocument();
    });
  });

  it("renders and remembers the native console preference across remounts", async () => {
    const api = {
      listLabs: async () => [],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-1", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    const { unmount } = render(<App api={api} />);

    expect(screen.getByLabelText("Native Console Preference")).toHaveValue(
      "web-console",
    );

    fireEvent.change(screen.getByLabelText("Native Console Preference"), {
      target: { value: "iterm-helper" },
    });

    await waitFor(() => {
      expect(window.localStorage.getItem("networkchum-native-console")).toBe(
        "iterm-helper",
      );
    });

    unmount();
    render(<App api={api} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Native Console Preference")).toHaveValue(
        "iterm-helper",
      );
    });
  });

  it("shows built-in terminals and an add terminal option", async () => {
    const api = {
      listLabs: async () => [],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-1", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    render(<App api={api} />);

    expect(screen.getByLabelText("macOS Terminal")).toHaveTextContent("iTerm");
    expect(screen.getByLabelText("macOS Terminal")).toHaveTextContent(
      "Terminal.app",
    );
    expect(screen.getByLabelText("macOS Terminal")).toHaveTextContent(
      "Add Terminal...",
    );
  });

  it("adds a custom terminal and persists it across remounts", async () => {
    const api = {
      listLabs: async () => [],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-1", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    const { unmount } = render(<App api={api} />);

    fireEvent.change(screen.getByLabelText("macOS Terminal"), {
      target: { value: "add-terminal" },
    });
    expect(
      screen.getByRole("dialog", { name: "Add Terminal" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Terminal Name"), {
      target: { value: "Ghostty" },
    });
    fireEvent.change(screen.getByLabelText("Terminal Command Template"), {
      target: { value: "ghostty -e /usr/local/bin/telnet {host} {port}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Terminal" }));

    await waitFor(() => {
      expect(screen.getByLabelText("macOS Terminal")).toHaveTextContent(
        "Ghostty",
      );
      expect(
        window.localStorage.getItem("networkchum-macos-terminals"),
      ).toContain("Ghostty");
    });

    unmount();
    render(<App api={api} />);

    await waitFor(() => {
      expect(screen.getByLabelText("macOS Terminal")).toHaveTextContent(
        "Ghostty",
      );
    });
  });

  it("edits a saved custom terminal", async () => {
    window.localStorage.setItem(
      "networkchum-macos-terminals",
      JSON.stringify([
        {
          id: "custom-ghostty",
          label: "Ghostty",
          template: "ghostty -e /usr/local/bin/telnet {host} {port}",
        },
      ]),
    );
    window.localStorage.setItem("networkchum-macos-terminal", "custom-ghostty");

    const api = {
      listLabs: async () => [],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-1", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    render(<App api={api} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Terminal" }));
    expect(
      screen.getByRole("dialog", { name: "Edit Terminal" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Terminal Command Template"), {
      target: {
        value:
          "ghostty --title networkchum -e /usr/local/bin/telnet {host} {port}",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Terminal" }));

    await waitFor(() => {
      expect(
        window.localStorage.getItem("networkchum-macos-terminals"),
      ).toContain(
        "ghostty --title networkchum -e /usr/local/bin/telnet {host} {port}",
      );
    });
  });

  it("deletes a saved custom terminal and falls back to iTerm", async () => {
    window.localStorage.setItem(
      "networkchum-macos-terminals",
      JSON.stringify([
        {
          id: "custom-ghostty",
          label: "Ghostty",
          template: "ghostty -e /usr/local/bin/telnet {host} {port}",
        },
      ]),
    );
    window.localStorage.setItem("networkchum-macos-terminal", "custom-ghostty");

    const api = {
      listLabs: async () => [],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-1", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };

    render(<App api={api} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Terminal" }));

    await waitFor(() => {
      expect(screen.getByLabelText("macOS Terminal")).toHaveValue("iterm");
      expect(
        window.localStorage.getItem("networkchum-macos-terminals"),
      ).not.toContain("Ghostty");
    });
  });

  it("shows bridge health as online when the bridge health check succeeds", async () => {
    const api = {
      listLabs: async () => [],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-1", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };
    const fetchSpy = vi.fn(async (input: string) => {
      if (input === "http://127.0.0.1:4010/health") {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(<App api={api} />);

    expect(await screen.findByText("Bridge: Online")).toBeInTheDocument();
  });

  it("shows bridge health as online on remote pages when the client-local bridge responds", async () => {
    const api = {
      listLabs: async () => [],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-1", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };
    const fetchSpy = vi.fn(async (input: string) => {
      if (input === "http://127.0.0.1:4010/health") {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <App
        api={api}
        locationLike={{ protocol: "http:", hostname: "192.168.2.57" }}
      />,
    );

    expect(await screen.findByText("Bridge: Online")).toBeInTheDocument();
  });

  it("remembers the macOS terminal preference across remounts", async () => {
    const api = {
      listLabs: async () => [],
      listCatalog: async () => [],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-1", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      listRuntimeStates: async () => [],
      addNode: async () => ({
        id: "lab-1",
        name: "New Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      }),
    };
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      json: async () => ({ ok: false }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const { unmount } = render(<App api={api} />);

    fireEvent.change(screen.getByLabelText("macOS Terminal"), {
      target: { value: "terminal-app" },
    });

    await waitFor(() => {
      expect(window.localStorage.getItem("networkchum-macos-terminal")).toBe(
        "terminal-app",
      );
    });

    unmount();
    render(<App api={api} />);

    await waitFor(() => {
      expect(screen.getByLabelText("macOS Terminal")).toHaveValue(
        "terminal-app",
      );
    });
  });

  it("shows busy runtime state for a node with an occupied native console", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })),
    );
    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Fetched Lab" }],
      listCatalog: async () => [
        { id: "arista-veos", name: "Arista vEOS", source: "image-bound" },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: {
          nodes: [
            { id: "node-1", name: "Arista-Veos-1", position: { x: 10, y: 10 } },
          ],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [
        {
          nodeId: "node-1",
          status: "running",
          connectCommand: ["telnet", "127.0.0.1", "5004"],
          consolePort: 5004,
          consoleInUse: true,
          message: "Serial console already in use by another client.",
        },
      ],
      addNode: async () => ({
        id: "lab-1",
        name: "Fetched Lab",
        document: { nodes: [], networks: [], attachments: [] },
      }),
      powerOnNode: async () => ({
        nodeId: "node-1",
        status: "running",
        connectCommand: ["telnet", "127.0.0.1", "5004"],
        message: null,
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Open Fetched Lab" });
    fireEvent.click(screen.getByRole("button", { name: "Open Fetched Lab" }));

    expect(await screen.findByText("Console Status: Busy")).toBeInTheDocument();
  });

  describe("Startup Config", () => {
    const createLabDocument = (
      actions: Pick<
        NodeBootActionState,
        "startupConfig" | "runningConfigBackup"
      >,
    ) => ({
      nodes: [
        {
          id: "node-1",
          name: "startup-node",
          position: { x: 10, y: 10 },
        },
      ],
      networks: [],
      attachments: [],
      startupConfigSets: [
        {
          id: "set-default",
          name: "Default",
          nodeConfigs: [],
        },
      ],
      nodeBootActions: [{ nodeId: "node-1", ...actions }],
      activeConfigSetId: "set-default",
    });

    const buildApi = (
      actions: Pick<
        NodeBootActionState,
        "startupConfig" | "runningConfigBackup"
      >,
    ) => {
      const lab = {
        id: "lab-1",
        name: "Startup Lab",
        autoBackup: false,
        document: createLabDocument(actions),
      };
      const setNodeConfig = vi.fn(async () => lab);
      const setNodeBootAction = vi.fn(async (_labId, _nodeId, nextActions) => ({
        ...lab,
        document: {
          ...lab.document,
          nodeBootActions: [{ nodeId: "node-1", ...nextActions }],
        },
      }));

      const api = {
        listLabs: async () => [{ id: lab.id, name: lab.name }],
        listCatalog: async () => [],
        createLab: async () => ({ id: "lab-2", name: "New Lab" }),
        getLab: async () => lab,
        listRuntimeStates: async () => [],
        addNode: async () => lab,
        powerOnNode: async () => ({
          nodeId: "node-1",
          status: "running",
          connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
          message: null,
        }),
        setNodeConfig,
        setNodeBootAction,
      };

      return { api, setNodeBootAction };
    };

    const openStartupConfigDialog = async () => {
      const node = await screen.findByTestId("node-node-1");
      fireEvent.mouseDown(node);
      fireEvent.click(node);
      const startupButton = await screen.findByRole("button", {
        name: "Startup Config",
      });
      fireEvent.click(startupButton);
      await screen.findByRole("dialog", { name: "Startup Config" });
    };

    it("renders separate dropdowns for config inject and backups", async () => {
      const { api } = buildApi({
        startupConfig: "always",
        runningConfigBackup: "once",
      });
      render(<App api={api} />);

      await openStartupConfigDialog();

      expect(screen.getByLabelText("Startup Config Action")).toHaveValue(
        "always",
      );
      expect(screen.getByLabelText("Running Config Backup")).toHaveValue(
        "once",
      );
    });

    it.each([
      ["always", "none"],
      ["once", "always"],
    ] as const)(
      "save with startup=%s and backup=%s calls setNodeBootAction with split actions",
      async (startupConfig, runningConfigBackup) => {
        const { api, setNodeBootAction } = buildApi({
          startupConfig: "none",
          runningConfigBackup: "none",
        });
        render(<App api={api} />);

        await openStartupConfigDialog();
        fireEvent.change(screen.getByLabelText("Startup Config Action"), {
          target: { value: startupConfig },
        });
        fireEvent.change(screen.getByLabelText("Running Config Backup"), {
          target: { value: runningConfigBackup },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => {
          expect(setNodeBootAction).toHaveBeenCalledWith("lab-1", "node-1", {
            startupConfig,
            runningConfigBackup,
          });
        });
      },
    );
  });

  describe("Cloud Settings", () => {
    it("opens cloud settings and saves the selected bridge interface", async () => {
      const lab = {
        id: "lab-1",
        name: "Cloud Lab",
        autoBackup: false,
        document: {
          nodes: [
            {
              id: "node-1",
              name: "cloud-1",
              runtime: "cloud",
              position: { x: 10, y: 10 },
              config: {
                vcpu: 0,
                ramMb: 0,
                interfaceCount: 1,
                bridgeInterface: null,
              },
              interfaces: [{ id: "if-1", name: "eth0", slot: 0 }],
            },
          ],
          networks: [],
          attachments: [],
          startupConfigSets: [],
          nodeBootActions: [],
          activeConfigSetId: null,
        },
      };

      const setNodeSettings = vi.fn(async () => ({
        ...lab,
        document: {
          ...lab.document,
          nodes: [
            {
              ...lab.document.nodes[0],
              config: {
                ...lab.document.nodes[0].config,
                bridgeInterface: "eno1",
              },
            },
          ],
        },
      }));

      const api = {
        listLabs: async () => [{ id: lab.id, name: lab.name }],
        listCatalog: async () => [],
        createLab: async () => ({ id: "lab-2", name: "New Lab" }),
        getLab: async () => lab,
        listRuntimeStates: async () => [],
        addNode: async () => lab,
        powerOnNode: async () => ({
          nodeId: "node-1",
          status: "running",
          connectCommand: undefined,
          message: null,
        }),
        listHostInterfaces: async () => ["eno1", "ens192"],
        setNodeSettings,
      };

      render(<App api={api} />);

      await screen.findByRole("button", { name: "Open Cloud Lab" });
      fireEvent.click(screen.getByRole("button", { name: "Open Cloud Lab" }));

      const node = await screen.findByTestId("node-node-1");
      fireEvent.mouseDown(node);
      fireEvent.click(node);

      fireEvent.click(screen.getByRole("button", { name: "Cloud Settings" }));
      await screen.findByRole("dialog", { name: "Cloud Settings" });

      fireEvent.change(screen.getByLabelText("Physical Interface"), {
        target: { value: "eno1" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(setNodeSettings).toHaveBeenCalledWith("lab-1", "node-1", {
          bridgeInterface: "eno1",
        });
      });
    });
  });

  it("creates a cloud node with the selected host interface", async () => {
    const addNode = vi.fn(
      async (
        _labId: string,
        input: {
          templateId: string;
          name: string;
          position: { x: number; y: number };
          interfaceCount?: number;
          bridgeInterface?: string | null;
        },
      ) => ({
        id: "lab-1",
        name: "Cloud Lab",
        document: {
          nodes: [
            {
              id: "node-cloud-1",
              name: input.name,
              runtime: "cloud",
              position: input.position,
              config: {
                vcpu: 0,
                ramMb: 0,
                interfaceCount: input.interfaceCount ?? 10,
                bridgeInterface: input.bridgeInterface ?? null,
              },
              interfaces: [{ id: "if-1", name: "eth0", slot: 0 }],
            },
          ],
          networks: [],
          attachments: [],
        },
      }),
    );

    const api = {
      listLabs: async () => [{ id: "lab-1", name: "Cloud Lab" }],
      listCatalog: async () => [
        {
          id: "cloud",
          name: "Cloud (External Network)",
          source: "built-in",
          runtime: "cloud",
          configSchema: {
            ramMb: { default: 0, min: 0, max: 0 },
            vcpu: { default: 0, min: 0, max: 0 },
            interfaceCount: { default: 10, min: 1, max: 24 },
          },
        },
      ],
      listImages: async () => [],
      createLab: async () => ({ id: "lab-2", name: "New Lab" }),
      getLab: async () => ({
        id: "lab-1",
        name: "Cloud Lab",
        document: {
          nodes: [],
          networks: [],
          attachments: [],
        },
      }),
      listRuntimeStates: async () => [],
      listHostInterfaces: async () => ["eno1", "ens192"],
      addNode,
      powerOnNode: async () => ({
        nodeId: "node-cloud-1",
        status: "running",
        connectCommand: undefined,
        message: null,
      }),
    };

    render(<App api={api} />);

    await screen.findByRole("button", { name: "Open Cloud Lab" });
    fireEvent.click(screen.getByRole("button", { name: "Devices" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Node" }));

    await screen.findByRole("dialog", { name: "Add Node" });
    fireEvent.change(screen.getByTestId("template-select"), {
      target: { value: "cloud" },
    });
    fireEvent.change(screen.getByLabelText("Physical Interface"), {
      target: { value: "eno1" },
    });
    fireEvent.click(screen.getByTestId("add-node-submit"));

    await waitFor(() => {
      expect(addNode).toHaveBeenCalledWith(
        "lab-1",
        expect.objectContaining({
          templateId: "cloud",
          bridgeInterface: "eno1",
        }),
      );
    });
  });
});
