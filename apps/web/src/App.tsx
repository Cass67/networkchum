import { Suspense, lazy, useEffect, useState } from "react";
import type {
  CloudRole,
  NodeBootAction,
  NodeBootActionState,
} from "@networkchum/shared";

import "./theme.css";

import { createApiClient } from "./api/client.js";
import type {
  ContainerEngine,
  RunningConfigBackupRecord,
} from "./api/client.js";
import { AddNodeDialog } from "./components/AddNodeDialog.js";
import { CloudNodeSettingsDialog } from "./components/CloudNodeSettingsDialog.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { ContextMenu } from "./components/ContextMenu.js";
import { ContainersTab } from "./components/ContainersTab.js";
import { DeviceCatalog } from "./components/DeviceCatalog.js";
import { ImageLibrary } from "./components/ImageLibrary.js";
import { LabBrowser } from "./components/LabBrowser.js";
import { LabDetails } from "./components/LabDetails.js";
import { SelectionPanel } from "./components/SelectionPanel.js";
import { StartupConfigDialog } from "./components/StartupConfigDialog.js";
import { TemplateEditorDialog } from "./components/TemplateEditorDialog.js";
import { TopologyCanvas } from "./components/TopologyCanvas.js";
import {
  isLocalPageHost,
  resolveApiBaseUrl,
  resolveBridgeBaseUrl,
} from "./runtimeUrls.js";

const NodeConsole = lazy(async () => {
  const module = await import("./components/NodeConsole.js");
  return { default: module.NodeConsole };
});

type LabSummary = {
  id: string;
  name: string;
  autoBackup?: boolean;
};

type CloudManagementCapabilities = {
  platform: string;
  managementCloudMode?: string;
};

type BackendHealthPayload = {
  ok: boolean;
  capabilities?: {
    cloudManagement?: CloudManagementCapabilities;
  };
};

type DeviceRoleIcon =
  | "router"
  | "switch"
  | "firewall"
  | "cloud"
  | "host"
  | "client";

type CatalogSummary = {
  id: string;
  name: string;
  source: string;
  vendor?: string;
  runtime?: string;
  deviceRoleIcon?: DeviceRoleIcon;
  configSchema?: {
    ramMb: { default: number; min: number; max: number };
    vcpu: { default: number; min: number; max: number };
    interfaceCount: { default: number; min: number; max: number };
  };
};

type EditableCatalogSummary = CatalogSummary & {
  configSchema: {
    ramMb: { default: number; min: number; max: number };
    vcpu: { default: number; min: number; max: number };
    interfaceCount: { default: number; min: number; max: number };
  };
};

type LabNodeData = {
  id: string;
  name: string;
  templateId?: string | null;
  runtime?: string;
  deviceRoleIcon?: DeviceRoleIcon;
  position?: { x: number; y: number };
  interfaces?: Array<{ id: string; name: string; slot: number }>;
  config?: {
    cloudRole?: CloudRole;
    bridgeGroup?: string | null;
  };
  state?: { desiredPower: string };
};

type StartupConfigSetData = {
  id: string;
  name: string;
  nodeConfigs: Array<{ nodeId: string; config: string }>;
};

type LabDocumentData = {
  nodes: LabNodeData[];
  networks: Array<{ id: string; kind: string; name: string; visible: boolean }>;
  attachments: Array<{ interfaceId: string; networkId: string }>;
  startupConfigSets?: StartupConfigSetData[];
  nodeBootActions?: NodeBootActionState[];
  activeConfigSetId?: string | null;
};

type ApiClient = {
  listLabs: () => Promise<LabSummary[]>;
  listCatalog: () => Promise<CatalogSummary[]>;
  getContainerRuntime?: () => Promise<{
    engine: ContainerEngine | null;
    available: boolean;
    message: string | null;
  }>;
  listContainerImages?: () => Promise<{
    engine: ContainerEngine | null;
    images: Array<{
      id: string;
      imageRef: string;
      repository: string;
      tag: string;
      size?: string;
    }>;
    message: string | null;
  }>;
  searchContainerImages?: (
    registry: string,
    query: string,
  ) => Promise<
    Array<{
      registry: string;
      imageRef: string;
      repository: string;
      description?: string;
      stars?: number;
    }>
  >;
  pullContainerImage?: (
    registry: string,
    imageRef: string,
  ) => Promise<{
    engine: ContainerEngine;
    imageRef: string;
    image: {
      id: string;
      imageRef: string;
      repository: string;
      tag: string;
      size?: string;
    } | null;
  }>;
  saveContainerTemplate?: (input: {
    displayName: string;
    imageRef: string;
    registry: string;
    shell?: string;
  }) => Promise<CatalogSummary>;
  createLab: (name: string) => Promise<LabSummary>;
  renameLab?: (
    labId: string,
    name: string,
  ) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  setLabAutoBackup?: (
    labId: string,
    autoBackup: boolean,
  ) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  listLabBackups?: (labId: string) => Promise<Array<{ fileName: string }>>;
  restoreLabBackup?: (
    labId: string,
    fileName: string,
  ) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  deleteLab?: (labId: string) => Promise<{ labId: string }>;
  getLab: (labId: string) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  addNode: (
    labId: string,
    input: {
      templateId: string;
      name: string;
      position: { x: number; y: number };
      interfaceCount?: number;
      cloudRole?: CloudRole;
      bridgeGroup?: string | null;
    },
  ) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  createContainerNode?: (
    labId: string,
    input: {
      displayName: string;
      imageRef: string;
      registry: string;
      shell?: string;
    },
  ) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  deleteNode?: (
    labId: string,
    nodeId: string,
  ) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  deleteCable?: (
    labId: string,
    networkId: string,
  ) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  powerOnNode: (
    labId: string,
    nodeId: string,
  ) => Promise<{
    nodeId: string;
    status: string;
    connectCommand?: string[];
    message?: string | null;
  }>;
  powerOffNode?: (
    labId: string,
    nodeId: string,
  ) => Promise<{
    nodeId: string;
    status: string;
    connectCommand?: string[];
    message?: string | null;
  }>;
  listRuntimeStates?: (labId: string) => Promise<
    Array<{
      nodeId: string;
      status: string;
      connectCommand?: string[];
      message?: string | null;
    }>
  >;
  listRunningConfigBackups?: (
    labId: string,
    nodeId: string,
  ) => Promise<RunningConfigBackupRecord[]>;
  listHostInterfaces?: () => Promise<string[]>;
  createNetwork?: (
    labId: string,
    input: { name: string; visible?: boolean },
  ) => Promise<{ network: { id: string } }>;
  attachInterfaces?: (
    labId: string,
    input: { networkId: string; interfaceIds: string[] },
  ) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  createConfigSet?: (
    labId: string,
    name: string,
  ) => Promise<{
    configSet: { id: string; name: string };
    lab: { id: string; name: string; document: LabDocumentData };
  }>;
  setActiveConfigSet?: (
    labId: string,
    activeConfigSetId: string | null,
  ) => Promise<{ id: string; name: string; document: LabDocumentData }>;
  setNodeConfig?: (
    labId: string,
    setId: string,
    nodeId: string,
    config: string,
  ) => Promise<{ id: string; name: string; document: LabDocumentData }>;
  setNodeBootAction?: (
    labId: string,
    nodeId: string,
    actions: {
      startupConfig: NodeBootAction;
      runningConfigBackup: NodeBootAction;
    },
  ) => Promise<{ id: string; name: string; document: LabDocumentData }>;
  setNodeSettings?: (
    labId: string,
    nodeId: string,
    settings: { cloudRole?: CloudRole; bridgeGroup?: string | null },
  ) => Promise<{ id: string; name: string; document: LabDocumentData }>;
  moveNode?: (
    labId: string,
    nodeId: string,
    position: { x: number; y: number },
  ) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  detachInterface?: (
    labId: string,
    interfaceId: string,
  ) => Promise<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  }>;
  listImages?: () => Promise<
    Array<{
      id: string;
      name: string;
      templateId: string | null;
      suggestedTemplateId?: string | null;
      source: string;
      catalogState: string;
    }>
  >;
  uploadImage?: (file: File) => Promise<{
    id: string;
    name: string;
    templateId: string | null;
    suggestedTemplateId?: string | null;
    source: string;
    catalogState: string;
  }>;
  bindImageToTemplate?: (
    imageId: string,
    templateId: string,
  ) => Promise<{
    id: string;
    name: string;
    templateId: string | null;
    suggestedTemplateId?: string | null;
    source: string;
    catalogState: string;
  }>;
  unbindImageFromTemplate?: (imageId: string) => Promise<{
    id: string;
    name: string;
    templateId: string | null;
    suggestedTemplateId?: string | null;
    source: string;
    catalogState: string;
  }>;
  removeImageFromCatalog?: (imageId: string) => Promise<{
    id: string;
    name: string;
    templateId: string | null;
    suggestedTemplateId?: string | null;
    source: string;
    catalogState: string;
  }>;
  deleteImageFile?: (imageId: string) => Promise<{
    id: string;
    name: string;
    templateId: string | null;
    suggestedTemplateId?: string | null;
    source: string;
    catalogState: string;
  }>;
  updateTemplate?: (
    templateId: string,
    input: {
      vcpu: number;
      ramMb: number;
      interfaceCount: number;
      deviceRoleIcon?: DeviceRoleIcon;
    },
  ) => Promise<{
    id: string;
    name: string;
    vendor?: string;
    runtime?: string;
    deviceRoleIcon?: DeviceRoleIcon;
    configSchema: {
      ramMb: { default: number; min: number; max: number };
      vcpu: { default: number; min: number; max: number };
      interfaceCount: { default: number; min: number; max: number };
    };
  }>;
};

function resolveBootActionState(
  entry:
    | NodeBootActionState
    | {
        nodeId: string;
        action?: "none" | "backup-once" | "inject-once";
      }
    | undefined,
): Pick<NodeBootActionState, "startupConfig" | "runningConfigBackup"> {
  if (!entry) {
    return { startupConfig: "none", runningConfigBackup: "none" };
  }

  if ("action" in entry && entry.action) {
    return {
      startupConfig: entry.action === "inject-once" ? "once" : "none",
      runningConfigBackup: entry.action === "backup-once" ? "once" : "none",
    };
  }

  if (!("startupConfig" in entry) || !("runningConfigBackup" in entry)) {
    return { startupConfig: "none", runningConfigBackup: "none" };
  }

  return {
    startupConfig: entry.startupConfig ?? "none",
    runningConfigBackup: entry.runningConfigBackup ?? "none",
  };
}

const demoLabs: LabSummary[] = [];
const demoCatalog: CatalogSummary[] = [
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
  {
    id: "juniper-vsrx",
    name: "Juniper vSRX",
    source: "built-in",
    vendor: "Juniper",
    runtime: "qemu",
    configSchema: {
      ramMb: { default: 4096, min: 2048, max: 16384 },
      vcpu: { default: 2, min: 1, max: 8 },
      interfaceCount: { default: 6, min: 2, max: 16 },
    },
  },
  {
    id: "fortinet-fortigate",
    name: "Fortinet FortiGate",
    source: "built-in",
    vendor: "Fortinet",
    runtime: "qemu",
    configSchema: {
      ramMb: { default: 1024, min: 512, max: 8192 },
      vcpu: { default: 1, min: 1, max: 4 },
      interfaceCount: { default: 4, min: 1, max: 16 },
    },
  },
  {
    id: "linux-alpine-container",
    name: "Alpine Container",
    source: "built-in",
    vendor: "Linux",
    runtime: "container",
    configSchema: {
      ramMb: { default: 256, min: 128, max: 4096 },
      vcpu: { default: 1, min: 1, max: 4 },
      interfaceCount: { default: 1, min: 1, max: 4 },
    },
  },
  {
    id: "linux-ubuntu-container",
    name: "Ubuntu Container",
    source: "built-in",
    vendor: "Linux",
    runtime: "container",
    configSchema: {
      ramMb: { default: 512, min: 256, max: 8192 },
      vcpu: { default: 1, min: 1, max: 4 },
      interfaceCount: { default: 1, min: 1, max: 4 },
    },
  },
  {
    id: "cloud",
    name: "Cloud (External Network)",
    source: "built-in",
    vendor: "NetworkChum",
    runtime: "cloud",
    configSchema: {
      ramMb: { default: 0, min: 0, max: 0 },
      vcpu: { default: 0, min: 0, max: 0 },
      interfaceCount: { default: 10, min: 1, max: 24 },
    },
  },
];

const browserApi = typeof fetch === "function" ? createApiClient(fetch) : null;
const THEME_STORAGE_KEY = "networkchum-theme";
const NATIVE_CONSOLE_STORAGE_KEY = "networkchum-native-console";
const MACOS_TERMINAL_STORAGE_KEY = "networkchum-macos-terminal";
const MACOS_TERMINAL_REGISTRY_STORAGE_KEY = "networkchum-macos-terminals";
const REMOTE_SSH_USER_STORAGE_KEY = "networkchum-remote-ssh-user";

type ThemeMode = "dark" | "light";
type NativeConsolePreference = "web-console" | "copy-command" | "iterm-helper";
type MacOsTerminalPreference = string;
type MacOsTerminalEntry = { id: string; label: string; template?: string };
type LocationLike = {
  protocol: string;
  hostname: string;
};

function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }

  try {
    return window.localStorage?.getItem(THEME_STORAGE_KEY) === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

function readStoredNativeConsolePreference(): NativeConsolePreference {
  if (typeof window === "undefined") {
    return "web-console";
  }

  try {
    const value = window.localStorage?.getItem(NATIVE_CONSOLE_STORAGE_KEY);
    return value === "copy-command" || value === "iterm-helper"
      ? value
      : "web-console";
  } catch {
    return "web-console";
  }
}

function readStoredMacOsTerminalPreference(): MacOsTerminalPreference {
  if (typeof window === "undefined") {
    return "iterm";
  }

  try {
    const stored = window.localStorage?.getItem(MACOS_TERMINAL_STORAGE_KEY);
    return stored && stored.length > 0 ? stored : "iterm";
  } catch {
    return "iterm";
  }
}

function readStoredMacOsTerminalRegistry(): MacOsTerminalEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.localStorage?.getItem(
      MACOS_TERMINAL_REGISTRY_STORAGE_KEY,
    );
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry) =>
            entry &&
            typeof entry.id === "string" &&
            typeof entry.label === "string",
        )
      : [];
  } catch {
    return [];
  }
}

function readStoredRemoteSshUser(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage?.getItem(REMOTE_SSH_USER_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function hasEditableConfig(
  entry: CatalogSummary,
): entry is EditableCatalogSummary {
  return entry.configSchema !== undefined;
}

const defaultApi: ApiClient = browserApi ?? {
  async listLabs() {
    return demoLabs;
  },
  async listCatalog() {
    return demoCatalog;
  },
  async getContainerRuntime() {
    return {
      engine: "docker" as const,
      available: true,
      message: null,
    };
  },
  async listContainerImages() {
    return {
      engine: "docker" as const,
      images: [
        {
          id: "img-container-demo",
          imageRef: "oraclelinux:9-slim",
          repository: "oraclelinux",
          tag: "9-slim",
          size: "72MB",
        },
      ],
      message: null,
    };
  },
  async searchContainerImages(_registry: string, query: string) {
    return [
      {
        registry: "docker-hub",
        imageRef: query || "oraclelinux:9-slim",
        repository: (query || "oraclelinux").split(":")[0] ?? "oraclelinux",
        description: "Demo search result",
        stars: 1,
      },
    ];
  },
  async pullContainerImage(_registry: string, imageRef: string) {
    return {
      engine: "docker" as const,
      imageRef,
      image: {
        id: "img-container-demo",
        imageRef,
        repository: imageRef.split(":")[0] ?? imageRef,
        tag: imageRef.split(":")[1] ?? "latest",
        size: "72MB",
      },
    };
  },
  async saveContainerTemplate(input: {
    displayName: string;
    imageRef: string;
    registry: string;
    shell?: string;
  }) {
    return {
      id: `user-container-${input.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: input.displayName,
      source: "built-in",
      vendor: "Container",
      runtime: "container",
      deviceRoleIcon: "host" as const,
      configSchema: {
        ramMb: { default: 512, min: 128, max: 8192 },
        vcpu: { default: 1, min: 1, max: 4 },
        interfaceCount: { default: 1, min: 1, max: 8 },
      },
    };
  },
  async createLab(name: string) {
    return { id: `lab-${Date.now()}`, name };
  },
  async renameLab(labId: string, name: string) {
    return {
      id: labId,
      name,
      autoBackup: false,
      document: {
        nodes: [],
        networks: [],
        attachments: [],
      },
    };
  },
  async getLab(labId: string) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      autoBackup: false,
      document: {
        nodes: [],
        networks: [],
        attachments: [],
      },
    };
  },
  async addNode(
    labId: string,
    input: {
      templateId: string;
      name: string;
      position: { x: number; y: number };
      interfaceCount?: number;
      cloudRole?: CloudRole;
      bridgeGroup?: string | null;
    },
  ) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      autoBackup: false,
      document: {
        nodes: [
          { id: "node-demo", name: input.name, position: input.position },
        ],
        networks: [],
        attachments: [],
      },
    };
  },
  async createContainerNode(
    labId: string,
    input: {
      displayName: string;
      imageRef: string;
      registry: string;
      shell?: string;
    },
  ) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      autoBackup: false,
      document: {
        nodes: [
          {
            id: "node-demo",
            name: input.displayName,
            runtime: "container",
            templateId: "linux-alpine-container",
            position: { x: 120, y: 80 },
          },
        ],
        networks: [],
        attachments: [],
      },
    };
  },
  async powerOnNode(_labId: string, nodeId: string) {
    return {
      nodeId,
      status: "running",
      connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      message: null,
    };
  },
  async powerOffNode(_labId: string, nodeId: string) {
    return {
      nodeId,
      status: "stopped",
      connectCommand: ["docker", "exec", "-it", "container-id", "sh"],
      message: null,
    };
  },
  async listRuntimeStates() {
    return [];
  },
  async listHostInterfaces() {
    return [];
  },
  async createNetwork() {
    return { network: { id: "net-demo" } };
  },
  async attachInterfaces(labId: string) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      document: { nodes: [], networks: [], attachments: [] },
    };
  },
  async moveNode(labId: string) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      document: { nodes: [], networks: [], attachments: [] },
    };
  },
  async detachInterface(labId: string) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      document: { nodes: [], networks: [], attachments: [] },
    };
  },
  async setNodeSettings(labId: string, _nodeId: string, settings) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      document: {
        nodes: [
          {
            id: "node-demo",
            name: "cloud-demo",
            runtime: "cloud",
            config: {
              cloudRole: settings.cloudRole ?? "management",
              bridgeGroup: settings.bridgeGroup ?? "management",
            },
          },
        ],
        networks: [],
        attachments: [],
      },
    };
  },
  async listImages() {
    return [];
  },
  async uploadImage() {
    return {
      id: "img-demo",
      name: "demo.qcow2",
      templateId: null,
      suggestedTemplateId: null,
      source: "upload",
      catalogState: "active",
    };
  },
  async bindImageToTemplate() {
    return {
      id: "img-demo",
      name: "demo.qcow2",
      templateId: "cisco-vios",
      suggestedTemplateId: "cisco-vios",
      source: "upload",
      catalogState: "active",
    };
  },
  async unbindImageFromTemplate() {
    return {
      id: "img-demo",
      name: "demo.qcow2",
      templateId: null,
      suggestedTemplateId: "cisco-vios",
      source: "upload",
      catalogState: "active",
    };
  },
  async removeImageFromCatalog() {
    return {
      id: "img-demo",
      name: "demo.qcow2",
      templateId: null,
      suggestedTemplateId: "cisco-vios",
      source: "upload",
      catalogState: "removed",
    };
  },
  async deleteImageFile() {
    return {
      id: "img-demo",
      name: "demo.qcow2",
      templateId: null,
      suggestedTemplateId: "cisco-vios",
      source: "upload",
      catalogState: "removed",
    };
  },
  async updateTemplate(
    templateId: string,
    input: {
      vcpu: number;
      ramMb: number;
      interfaceCount: number;
      deviceRoleIcon?: DeviceRoleIcon;
    },
  ) {
    return {
      id: templateId,
      name:
        demoCatalog.find((entry) => entry.id === templateId)?.name ??
        templateId,
      vendor: demoCatalog.find((entry) => entry.id === templateId)?.vendor,
      runtime: demoCatalog.find((entry) => entry.id === templateId)?.runtime,
      deviceRoleIcon: input.deviceRoleIcon,
      configSchema: {
        ramMb: { default: input.ramMb, min: 128, max: 16384 },
        vcpu: { default: input.vcpu, min: 1, max: 8 },
        interfaceCount: { default: input.interfaceCount, min: 1, max: 24 },
      },
    };
  },
  async deleteLab(labId: string) {
    return { labId };
  },
  async deleteNode(labId: string) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      autoBackup: false,
      document: { nodes: [], networks: [], attachments: [] },
    };
  },
  async deleteCable(labId: string) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      autoBackup: false,
      document: { nodes: [], networks: [], attachments: [] },
    };
  },
  async setLabAutoBackup(labId: string, autoBackup: boolean) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      autoBackup,
      document: { nodes: [], networks: [], attachments: [] },
    };
  },
  async listLabBackups() {
    return [];
  },
  async restoreLabBackup(labId: string) {
    return {
      id: labId,
      name: demoLabs[0]?.name ?? "Demo Lab",
      autoBackup: false,
      document: { nodes: [], networks: [], attachments: [] },
    };
  },
};

export function App({
  api = defaultApi,
  locationLike = window.location,
}: {
  api?: ApiClient;
  locationLike?: LocationLike;
}) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const initialTheme = readStoredTheme();

    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", initialTheme);
    }

    return initialTheme;
  });
  const [nativeConsolePreference, setNativeConsolePreference] =
    useState<NativeConsolePreference>(() =>
      readStoredNativeConsolePreference(),
    );
  const [macOsTerminalPreference, setMacOsTerminalPreference] =
    useState<MacOsTerminalPreference>(() =>
      readStoredMacOsTerminalPreference(),
    );
  const [macOsTerminalRegistry, setMacOsTerminalRegistry] = useState<
    MacOsTerminalEntry[]
  >(() => readStoredMacOsTerminalRegistry());
  const [remoteSshUser, setRemoteSshUser] = useState<string>(() =>
    readStoredRemoteSshUser(),
  );
  const [bridgeStatus, setBridgeStatus] = useState<"online" | "offline">(
    "offline",
  );
  const [backendHealth, setBackendHealth] =
    useState<BackendHealthPayload | null>(null);
  const [nativeConsoleError, setNativeConsoleError] = useState<string | null>(
    null,
  );
  const [terminalDialogMode, setTerminalDialogMode] = useState<
    "add" | "edit" | null
  >(null);
  const [newTerminalName, setNewTerminalName] = useState("");
  const [newTerminalTemplate, setNewTerminalTemplate] = useState("");
  const [labs, setLabs] = useState<LabSummary[]>([]);
  const [catalog, setCatalog] = useState<CatalogSummary[]>(demoCatalog);
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, string>>({});
  const [nodeConnectCommands, setNodeConnectCommands] = useState<
    Record<string, string[]>
  >({});
  const [nodeMessages, setNodeMessages] = useState<
    Record<string, string | null>
  >({});
  const [selectedNodeBackups, setSelectedNodeBackups] = useState<
    RunningConfigBackupRecord[]
  >([]);
  const [createLabError, setCreateLabError] = useState<string | null>(null);
  const [selectedLabId, setSelectedLabId] = useState<string | null>(null);
  const [selectedLab, setSelectedLab] = useState<{
    id: string;
    name: string;
    autoBackup?: boolean;
    document: LabDocumentData;
  } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showAddNodeDialog, setShowAddNodeDialog] = useState(false);
  const [dialogTemplateId, setDialogTemplateId] = useState<string | null>(null);
  const [consoleNode, setConsoleNode] = useState<{
    nodeId: string;
    nodeName: string;
  } | null>(null);
  const [images, setImages] = useState<
    Array<{
      id: string;
      name: string;
      templateId: string | null;
      suggestedTemplateId?: string | null;
      source: string;
      catalogState: string;
    }>
  >([]);
  const [selectedCableId, setSelectedCableId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: Array<{ label: string; onSelect: () => void }>;
  } | null>(null);
  const [confirmState, setConfirmState] = useState<
    | null
    | { type: "delete-lab"; labId: string }
    | { type: "delete-node"; nodeId: string }
    | { type: "delete-cable"; networkId: string }
  >(null);
  const [backupDialog, setBackupDialog] = useState<null | {
    labId: string;
    labName: string;
    backups: Array<{ fileName: string }>;
  }>(null);
  const [restoreBackupTarget, setRestoreBackupTarget] = useState<null | {
    labId: string;
    labName: string;
    fileName: string;
  }>(null);
  const [leftTab, setLeftTab] = useState<
    "labs" | "devices" | "containers" | "images"
  >("labs");
  const [startupConfigDialog, setStartupConfigDialog] = useState<{
    nodeId: string;
    nodeName: string;
  } | null>(null);
  const [cloudNodeSettingsDialog, setCloudNodeSettingsDialog] = useState<{
    nodeId: string;
    nodeName: string;
    cloudRole?: CloudRole;
    bridgeGroup?: string | null;
  } | null>(null);
  const [hostInterfaces, setHostInterfaces] = useState<string[]>([]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);

    try {
      window.localStorage?.setItem(THEME_STORAGE_KEY, themeMode);
    } catch {
      // Ignore storage failures and keep the in-memory theme.
    }
  }, [themeMode]);

  useEffect(() => {
    try {
      window.localStorage?.setItem(
        NATIVE_CONSOLE_STORAGE_KEY,
        nativeConsolePreference,
      );
    } catch {
      // Ignore storage failures and keep the in-memory preference.
    }
  }, [nativeConsolePreference]);

  useEffect(() => {
    try {
      window.localStorage?.setItem(
        MACOS_TERMINAL_STORAGE_KEY,
        macOsTerminalPreference,
      );
    } catch {
      // Ignore storage failures and keep the in-memory preference.
    }
  }, [macOsTerminalPreference]);

  useEffect(() => {
    try {
      window.localStorage?.setItem(
        MACOS_TERMINAL_REGISTRY_STORAGE_KEY,
        JSON.stringify(macOsTerminalRegistry),
      );
    } catch {
      // Ignore storage failures and keep the in-memory registry.
    }
  }, [macOsTerminalRegistry]);

  useEffect(() => {
    try {
      window.localStorage?.setItem(
        REMOTE_SSH_USER_STORAGE_KEY,
        remoteSshUser.trim(),
      );
    } catch {
      // Ignore storage failures and keep the in-memory preference.
    }
  }, [remoteSshUser]);

  useEffect(() => {
    let cancelled = false;
    const bridgeBaseUrl = resolveBridgeBaseUrl(locationLike);

    if (!bridgeBaseUrl) {
      setBridgeStatus("offline");
      return () => {
        cancelled = true;
      };
    }

    void fetch(`${bridgeBaseUrl}/health`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("offline")),
      )
      .then((payload) => {
        if (!cancelled) {
          setBridgeStatus(payload.ok ? "online" : "offline");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBridgeStatus("offline");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [locationLike]);

  useEffect(() => {
    let cancelled = false;
    const apiBaseUrl = resolveApiBaseUrl(locationLike);

    void fetch(`${apiBaseUrl}/health`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("offline")),
      )
      .then((payload: BackendHealthPayload) => {
        if (!cancelled) {
          setBackendHealth(payload);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackendHealth({ ok: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [locationLike]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      api.listLabs(),
      api.listCatalog(),
      api.listImages?.() ?? Promise.resolve([]),
    ])
      .then(([nextLabs, nextCatalog, nextImages]) => {
        if (cancelled) {
          return;
        }

        setLabs(nextLabs);
        setCatalog(nextCatalog);
        setImages(nextImages);
        setSelectedLabId((current) => {
          if (current && nextLabs.length === 0) {
            return current;
          }

          if (current && nextLabs.some((lab) => lab.id === current)) {
            return current;
          }

          return nextLabs[0]?.id ?? null;
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setLabs(demoLabs);
        setCatalog(demoCatalog);
        setImages([]);
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!selectedLabId) {
      setSelectedLab(null);
      return;
    }

    let cancelled = false;

    void api
      .getLab(selectedLabId)
      .then((lab) => {
        if (!cancelled) {
          setSelectedLab(lab);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedLab(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, selectedLabId]);

  useEffect(() => {
    if (!selectedLabId) {
      return;
    }

    const runRefresh = async () => {
      if (!api.listRuntimeStates) {
        return;
      }

      const states = await api.listRuntimeStates(selectedLabId);
      setNodeStatuses(
        Object.fromEntries(states.map((state) => [state.nodeId, state.status])),
      );
      setNodeMessages(
        Object.fromEntries(
          states.map((state) => [state.nodeId, state.message ?? null]),
        ),
      );
      setNodeConnectCommands(
        Object.fromEntries(
          states
            .filter((state) => state.connectCommand?.length)
            .map((state) => [state.nodeId, state.connectCommand ?? []]),
        ),
      );
    };

    void runRefresh();

    const handleFocus = () => {
      void runRefresh();
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [api.listRuntimeStates, selectedLabId]);

  const listRunningConfigBackups = api.listRunningConfigBackups;

  useEffect(() => {
    if (!listRunningConfigBackups || !selectedLabId || !selectedNodeId) {
      setSelectedNodeBackups([]);
      return;
    }

    let cancelled = false;

    void listRunningConfigBackups(selectedLabId, selectedNodeId)
      .then((records) => {
        if (!cancelled) {
          setSelectedNodeBackups(records);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedNodeBackups([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [listRunningConfigBackups, selectedLabId, selectedNodeId]);

  function applyLabUpdate(nextLab: {
    id: string;
    name: string;
    document: LabDocumentData;
  }) {
    setSelectedLab(nextLab);
    setLabs((current) =>
      current.map((lab) =>
        lab.id === nextLab.id ? { ...lab, name: nextLab.name } : lab,
      ),
    );
  }

  async function handleCreateLab() {
    try {
      const newLab = await api.createLab("New Lab");
      setCreateLabError(null);
      setLabs((current) => [...current, newLab]);
      setSelectedLabId(newLab.id);
    } catch {
      setCreateLabError("Failed to create lab");
    }
  }

  async function handleAddLinuxVm() {
    if (!selectedLabId) {
      return;
    }

    const nextLab = await api.addNode(selectedLabId, {
      templateId: "linux-ubuntu-container",
      name: `ubuntu-${(selectedLab?.document.nodes.length ?? 0) + 1}`,
      position: { x: 120, y: 80 },
    });
    applyLabUpdate(nextLab);
  }

  async function handleAddAlpineContainer() {
    if (!selectedLabId) {
      return;
    }

    const nextLab = await api.addNode(selectedLabId, {
      templateId: "linux-alpine-container",
      name: `alpine-${(selectedLab?.document.nodes.length ?? 0) + 1}`,
      position: { x: 180, y: 140 },
    });
    applyLabUpdate(nextLab);
  }

  async function handleAddNode(input: {
    templateId: string;
    name: string;
    position: { x: number; y: number };
    interfaceCount?: number;
    cloudRole?: CloudRole;
    bridgeGroup?: string | null;
  }) {
    if (!selectedLabId) {
      return;
    }

    const nextLab = await api.addNode(selectedLabId, input);
    applyLabUpdate(nextLab);
    setShowAddNodeDialog(false);
    setDialogTemplateId(null);
  }

  async function handleRenameLab(labId: string, name: string) {
    if (!api.renameLab) {
      return;
    }

    const nextLab = await api.renameLab(labId, name.trim());
    applyLabUpdate(nextLab);
  }

  async function handleSetLabAutoBackup(labId: string, autoBackup: boolean) {
    if (!api.setLabAutoBackup) {
      return;
    }

    const nextLab = await api.setLabAutoBackup(labId, autoBackup);
    applyLabUpdate(nextLab);
    setLabs((current) =>
      current.map((lab) => (lab.id === labId ? { ...lab, autoBackup } : lab)),
    );
  }

  async function handleOpenLabBackups(labId: string) {
    if (!api.listLabBackups) {
      return;
    }

    const backups = await api.listLabBackups(labId);
    const labName = labs.find((lab) => lab.id === labId)?.name ?? "Lab";
    setBackupDialog({ labId, labName, backups });
  }

  async function handleRestoreLabBackup(labId: string, fileName: string) {
    if (!api.restoreLabBackup) {
      return;
    }

    const nextLab = await api.restoreLabBackup(labId, fileName);
    applyLabUpdate(nextLab);
    setLabs((current) =>
      current.map((lab) =>
        lab.id === labId
          ? { ...lab, name: nextLab.name, autoBackup: nextLab.autoBackup }
          : lab,
      ),
    );
    setRestoreBackupTarget(null);
    setBackupDialog(null);
  }

  async function handlePowerOnNode(nodeId: string) {
    if (!selectedLabId) {
      return;
    }

    const state = await api.powerOnNode(selectedLabId, nodeId);
    setNodeStatuses((current) => ({
      ...current,
      [state.nodeId]: state.status,
    }));
    setNodeMessages((current) => ({
      ...current,
      [state.nodeId]: state.message ?? null,
    }));
    if (state.connectCommand?.length) {
      setNodeConnectCommands((current) => ({
        ...current,
        [state.nodeId]: state.connectCommand ?? [],
      }));
    }
  }

  function handleConnectNode(nodeId: string) {
    const command = nodeConnectCommands[nodeId];
    if (!command?.length) return;

    if (command[0] === "telnet") {
      const node = selectedLab?.document.nodes.find((n) => n.id === nodeId);
      setConsoleNode({ nodeId, nodeName: node?.name ?? nodeId });
    } else {
      window.alert(command.join(" "));
    }
  }

  function buildItermHelperUrl(command: string[]) {
    if (command[0] !== "telnet" || !command[1] || !command[2]) {
      return null;
    }

    const request: {
      terminal: MacOsTerminalPreference;
      host: string;
      port: number;
      relayHost?: string;
      relayUser?: string;
    } = {
      terminal: macOsTerminalPreference,
      host: command[1],
      port: Number(command[2]),
    };

    if (!isLocalPageHost(locationLike.hostname)) {
      request.relayHost = locationLike.hostname;
      if (remoteSshUser.trim()) {
        request.relayUser = remoteSshUser.trim();
      }
    }

    return request;
  }

  function buildNativeConsoleCommand(command: string[]) {
    if (command[0] !== "telnet" || !command[1] || !command[2]) {
      return null;
    }

    const localCommand = `socat STDIO,rawer,echo=0 TCP:${command[1]}:${command[2]}`;
    if (isLocalPageHost(locationLike.hostname)) {
      return localCommand;
    }

    const relayTarget = remoteSshUser.trim()
      ? `${remoteSshUser.trim()}@${locationLike.hostname}`
      : locationLike.hostname;
    return `ssh -t ${relayTarget} '${localCommand}'`;
  }

  function promptForNativeConsoleCommand(nativeCommand: string) {
    window.prompt(
      "Clipboard access is unavailable. Copy this command manually:",
      nativeCommand,
    );
  }

  function openWebConsole(nodeId: string) {
    const node = selectedLab?.document.nodes.find((n) => n.id === nodeId);
    setConsoleNode({ nodeId, nodeName: node?.name ?? nodeId });
  }

  async function handleOpenNativeConsole(nodeId: string) {
    const command = nodeConnectCommands[nodeId];
    if (
      !command?.length ||
      command[0] !== "telnet" ||
      !command[1] ||
      !command[2]
    ) {
      return;
    }

    if (nativeConsolePreference === "web-console") {
      openWebConsole(nodeId);
      return;
    }

    if (nativeConsolePreference === "copy-command") {
      await handleCopyNativeCommand(nodeId);
      return;
    }

    const helperRequest = buildItermHelperUrl(command);
    if (helperRequest) {
      const bridgeBaseUrl = resolveBridgeBaseUrl(locationLike);
      if (!bridgeBaseUrl) {
        setBridgeStatus("offline");
        await handleCopyNativeCommand(nodeId);
        setNativeConsoleError(null);
        return;
      }

      try {
        const response = await fetch(`${bridgeBaseUrl}/open-console`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(helperRequest),
        });

        if (!response.ok) {
          throw new Error("Native console bridge is not running.");
        }

        setNativeConsoleError(null);
      } catch {
        setBridgeStatus("offline");
        await handleCopyNativeCommand(nodeId);
        setNativeConsoleError(
          "Native console bridge is not running. Copy the command instead.",
        );
      }
    }
  }

  async function handleCopyNativeCommand(nodeId: string) {
    const command = nodeConnectCommands[nodeId];
    if (!command?.length) {
      return;
    }

    const nativeCommand = buildNativeConsoleCommand(command);
    if (!nativeCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(nativeCommand);
      setNativeConsoleError(null);
    } catch {
      promptForNativeConsoleCommand(nativeCommand);
      setNativeConsoleError(
        "Clipboard access is unavailable on this page. Copy the command from the prompt.",
      );
    }
  }

  async function handleDisconnectNativeConsole(nodeId: string) {
    if (!selectedLabId) {
      return;
    }

    const apiBaseUrl = resolveApiBaseUrl(locationLike);
    await fetch(
      `${apiBaseUrl}/labs/${selectedLabId}/nodes/${nodeId}/disconnect-console`,
      {
        method: "POST",
      },
    );

    if (api.listRuntimeStates) {
      const states = await api.listRuntimeStates(selectedLabId);
      setNodeStatuses(
        Object.fromEntries(states.map((state) => [state.nodeId, state.status])),
      );
      setNodeMessages(
        Object.fromEntries(
          states.map((state) => [state.nodeId, state.message ?? null]),
        ),
      );
      setNodeConnectCommands(
        Object.fromEntries(
          states
            .filter((state) => state.connectCommand?.length)
            .map((state) => [state.nodeId, state.connectCommand ?? []]),
        ),
      );
    }
  }

  function handleSelectTemplate(templateId: string) {
    if (api.listHostInterfaces) {
      void api
        .listHostInterfaces()
        .then((interfaces) => {
          setHostInterfaces(interfaces);
        })
        .catch(() => {
          setHostInterfaces([]);
        });
    }
    setDialogTemplateId(templateId);
    setShowAddNodeDialog(true);
  }

  function handleOpenAddNodeDialog() {
    if (api.listHostInterfaces) {
      void api
        .listHostInterfaces()
        .then((interfaces) => {
          setHostInterfaces(interfaces);
        })
        .catch(() => {
          setHostInterfaces([]);
        });
    }
    setDialogTemplateId(null);
    setShowAddNodeDialog(true);
  }

  async function handleRefreshLab() {
    if (!selectedLabId) return;
    try {
      const lab = await api.getLab(selectedLabId);
      applyLabUpdate(lab);
    } catch {
      // keep existing state
    }
  }

  const selectedNode =
    selectedLab?.document.nodes.find((node) => node.id === selectedNodeId) ??
    null;
  const selectedCable =
    selectedLab?.document.networks.find(
      (network) => network.id === selectedCableId,
    ) ?? null;
  const selectedImage =
    images.find((image) => image.id === selectedImageId) ?? null;
  const editingTemplate = editingTemplateId
    ? (catalog.find(
        (entry): entry is EditableCatalogSummary =>
          entry.id === editingTemplateId && hasEditableConfig(entry),
      ) ?? null)
    : null;
  const selection = selectedImage
    ? { type: "image" as const, image: selectedImage }
    : selectedNode
      ? {
          type: "node" as const,
          node: selectedNode,
          status:
            nodeStatuses[selectedNode.id] ??
            (selectedNode.state?.desiredPower === "on" ? "running" : "stopped"),
          connectCommand: nodeConnectCommands[selectedNode.id],
        }
      : selectedCable
        ? {
            type: "cable" as const,
            cable: { id: selectedCable.id, name: selectedCable.name },
          }
        : selectedLab
          ? {
              type: "lab" as const,
              lab: {
                id: selectedLab.id,
                name: selectedLab.name,
                autoBackup: selectedLab.autoBackup,
              },
            }
          : null;

  const cloudManagementCapabilities =
    backendHealth?.capabilities?.cloudManagement ?? null;

  const backendLabel = (() => {
    if (!cloudManagementCapabilities) {
      if (backendHealth?.ok === false) return "Backend: Offline";
      return "Backend: Unknown";
    }

    if (cloudManagementCapabilities.platform === "macos") {
      if (
        cloudManagementCapabilities.managementCloudMode === "macos-host-only"
      ) {
        return "Backend: macOS host-only management";
      }
      return "Backend: macOS management";
    }

    if (cloudManagementCapabilities.platform === "linux") {
      return "Backend: Linux management";
    }

    return `Backend: ${cloudManagementCapabilities.platform} management`;
  })();

  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const canvasNodes = (selectedLab?.document.nodes ?? []).map((node) => {
    const catalogEntry = node.templateId
      ? catalogById.get(node.templateId)
      : undefined;
    return {
      ...node,
      deviceRoleIcon: node.deviceRoleIcon ?? catalogEntry?.deviceRoleIcon,
    };
  });

  async function refreshImages() {
    if (!api.listImages) return;
    const nextImages = await api.listImages();
    setImages(nextImages);
    setSelectedImageId((current) =>
      current && !nextImages.some((image) => image.id === current)
        ? null
        : current,
    );
  }

  async function refreshCatalog() {
    const nextCatalog = await api.listCatalog();
    setCatalog(nextCatalog);
  }

  async function handleDeleteImageFile(imageId: string) {
    if (!api.deleteImageFile) {
      return;
    }

    await api.deleteImageFile(imageId);
    await refreshImages();
  }

  function applyTemplateUpdate(nextTemplate: {
    id: string;
    name: string;
    vendor?: string;
    runtime?: string;
    deviceRoleIcon?: DeviceRoleIcon;
    configSchema: {
      ramMb: { default: number; min: number; max: number };
      vcpu: { default: number; min: number; max: number };
      interfaceCount: { default: number; min: number; max: number };
    };
  }) {
    setCatalog((current) =>
      current.map((entry) =>
        entry.id === nextTemplate.id
          ? {
              ...entry,
              name: nextTemplate.name,
              vendor: nextTemplate.vendor,
              runtime: nextTemplate.runtime,
              configSchema: nextTemplate.configSchema,
              deviceRoleIcon:
                nextTemplate.deviceRoleIcon ?? entry.deviceRoleIcon,
            }
          : entry,
      ),
    );
  }

  async function handlePowerOffNode(nodeId: string) {
    if (!selectedLabId || !api.powerOffNode) return;
    const state = await api.powerOffNode(selectedLabId, nodeId);
    setNodeStatuses((current) => ({
      ...current,
      [state.nodeId]: state.status,
    }));
  }

  function handleOpenStartupConfigDialog(nodeId: string) {
    const node = selectedLab?.document.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setStartupConfigDialog({ nodeId, nodeName: node.name });
  }

  function handleOpenCloudNodeSettingsDialog(nodeId: string) {
    const node = selectedLab?.document.nodes.find(
      (candidate) => candidate.id === nodeId,
    );
    if (!node || node.runtime !== "cloud") {
      return;
    }

    setCloudNodeSettingsDialog({
      nodeId,
      nodeName: node.name,
      cloudRole: node.config?.cloudRole,
      bridgeGroup: node.config?.bridgeGroup,
    });
  }

  async function handleSaveStartupConfig(
    nodeId: string,
    config: string,
    actions: {
      startupConfig: NodeBootAction;
      runningConfigBackup: NodeBootAction;
    },
  ) {
    if (!selectedLabId || !selectedLab || !api.setNodeConfig) return;

    const doc = selectedLab.document;
    let setId = doc.activeConfigSetId ?? null;

    // Auto-create "Default" config set if none exist
    if (!doc.startupConfigSets?.length) {
      if (!api.createConfigSet) return;
      const result = await api.createConfigSet(selectedLabId, "Default");
      setId = result.configSet.id;
    }

    // Auto-activate — either the set we just created or the first existing one
    if (!setId) {
      const firstSet = (doc.startupConfigSets ?? [])[0];
      if (!firstSet) return;
      setId = firstSet.id;
    }

    if (doc.activeConfigSetId !== setId) {
      if (!api.setActiveConfigSet) return;
      await api.setActiveConfigSet(selectedLabId, setId);
    }

    const nextLab = await api.setNodeConfig(
      selectedLabId,
      setId,
      nodeId,
      config,
    );
    const finalLab = api.setNodeBootAction
      ? await api.setNodeBootAction(selectedLabId, nodeId, actions)
      : nextLab;
    applyLabUpdate(finalLab);
  }

  async function handleSaveCloudNodeSettings(
    nodeId: string,
    settings: { cloudRole: CloudRole; bridgeGroup: string },
  ) {
    if (!selectedLabId || !api.setNodeSettings) {
      return;
    }

    const nextLab = await api.setNodeSettings(selectedLabId, nodeId, settings);
    applyLabUpdate(nextLab);
  }

  function resolveNodeBootActions(
    nodeId: string,
  ): Pick<NodeBootActionState, "startupConfig" | "runningConfigBackup"> {
    return resolveBootActionState(
      selectedLab?.document.nodeBootActions?.find(
        (candidate) => candidate.nodeId === nodeId,
      ),
    );
  }

  async function handleConfirm() {
    if (!confirmState || !selectedLabId) return;

    if (confirmState.type === "delete-lab" && api.deleteLab) {
      await api.deleteLab(confirmState.labId);
      setLabs((current) =>
        current.filter((lab) => lab.id !== confirmState.labId),
      );
      setSelectedLabId(null);
      setSelectedLab(null);
    }

    if (confirmState.type === "delete-node" && api.deleteNode) {
      const nextLab = await api.deleteNode(selectedLabId, confirmState.nodeId);
      applyLabUpdate(nextLab);
      setSelectedNodeId(null);
    }

    if (confirmState.type === "delete-cable" && api.deleteCable) {
      const nextLab = await api.deleteCable(
        selectedLabId,
        confirmState.networkId,
      );
      applyLabUpdate(nextLab);
      setSelectedCableId(null);
    }

    setConfirmState(null);
  }

  const leftPanelTitle =
    leftTab === "labs"
      ? "Labs"
      : leftTab === "devices"
        ? "Devices"
        : leftTab === "containers"
          ? "Containers"
          : "Images";
  const leftPanelDescription =
    leftTab === "labs"
      ? "Create labs, reopen saved topologies, and keep your active workspace in view."
      : leftTab === "devices"
        ? "Drop templates into the current lab without leaving the canvas."
        : leftTab === "containers"
          ? "Discover container images, pull from registries, and turn them into reusable templates or one-off nodes."
          : "Manage uploaded disk images and bind them to reusable templates.";
  const themeToggleLabel =
    themeMode === "dark" ? "Switch to day mode" : "Switch to night mode";
  const themeToggleText = themeMode === "dark" ? "Day Mode" : "Night Mode";
  const nativeConsoleModeLabel =
    nativeConsolePreference === "web-console"
      ? "Web Console"
      : nativeConsolePreference === "copy-command"
        ? "Copy Native Command"
        : macOsTerminalPreference === "terminal-app"
          ? "Open in Terminal.app"
          : "Open in iTerm";

  const macOsTerminalOptions = [
    { value: "iterm", label: "iTerm" },
    { value: "terminal-app", label: "Terminal.app" },
    ...macOsTerminalRegistry.map((entry) => ({
      value: entry.id,
      label: entry.label,
    })),
    { value: "add-terminal", label: "Add Terminal..." },
  ];
  const selectedCustomTerminal =
    macOsTerminalRegistry.find(
      (entry) => entry.id === macOsTerminalPreference,
    ) ?? null;

  function handleSaveTerminal() {
    const label = newTerminalName.trim();
    const template = newTerminalTemplate.trim();
    if (!label || !template) {
      return;
    }

    const id = `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const nextEntry = { id, label, template };
    setMacOsTerminalRegistry((current) => [
      ...current.filter((entry) => entry.id !== id),
      nextEntry,
    ]);
    setMacOsTerminalPreference(id as MacOsTerminalPreference);
    setTerminalDialogMode(null);
    setNewTerminalName("");
    setNewTerminalTemplate("");
  }

  function openAddTerminalDialog() {
    setNewTerminalName("");
    setNewTerminalTemplate("");
    setTerminalDialogMode("add");
  }

  function openEditTerminalDialog() {
    if (!selectedCustomTerminal) return;
    setNewTerminalName(selectedCustomTerminal.label);
    setNewTerminalTemplate(selectedCustomTerminal.template ?? "");
    setTerminalDialogMode("edit");
  }

  function handleDeleteTerminal() {
    if (!selectedCustomTerminal) {
      return;
    }

    setMacOsTerminalRegistry((current) =>
      current.filter((entry) => entry.id !== selectedCustomTerminal.id),
    );
    setMacOsTerminalPreference("iterm");
    setTerminalDialogMode(null);
    setNewTerminalName("");
    setNewTerminalTemplate("");
  }

  return (
    <div className="app-shell" style={{ overflow: "hidden" }}>
      <header className="topbar">
        <div className="topbar-brand">
          <div className="topbar-mark" aria-hidden="true">
            <span className="topbar-mark-dot" />
          </div>
          <div className="topbar-brand-copy">
            <p className="topbar-kicker">Network Lab Control</p>
            <h1 className="topbar-logo">NetworkChum</h1>
          </div>
        </div>
        <div className={`topbar-context${selectedLab ? "" : " is-empty"}`}>
          <span className="topbar-context-label">Active Lab</span>
          <span className="topbar-lab-name">
            {selectedLab?.name ?? "No lab selected"}
          </span>
          <span className="topbar-context-meta">
            {selectedLab
              ? `${selectedLab.document.nodes.length} node${selectedLab.document.nodes.length === 1 ? "" : "s"}`
              : "Create a lab to start mapping nodes"}
          </span>
        </div>
        <div className="topbar-spacer" />
        <label className="field" style={{ minWidth: 220 }}>
          <span className="field-label">Native Console Preference</span>
          <select
            className="field-input"
            aria-label="Native Console Preference"
            value={nativeConsolePreference}
            onChange={(event) =>
              setNativeConsolePreference(
                event.target.value as NativeConsolePreference,
              )
            }
          >
            <option value="web-console">Web Console</option>
            <option value="copy-command">Copy Native Command</option>
            <option value="iterm-helper">Open in Terminal</option>
          </select>
        </label>
        <label className="field" style={{ minWidth: 220 }}>
          <span className="field-label">macOS Terminal</span>
          <select
            className="field-input"
            aria-label="macOS Terminal"
            value={macOsTerminalPreference}
            onChange={(event) => {
              if (event.target.value === "add-terminal") {
                openAddTerminalDialog();
                return;
              }
              setMacOsTerminalPreference(
                event.target.value as MacOsTerminalPreference,
              );
            }}
          >
            {macOsTerminalOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {!isLocalPageHost(locationLike.hostname) ? (
          <label className="field" style={{ minWidth: 180 }}>
            <span className="field-label">SSH Relay User</span>
            <input
              className="field-input"
              aria-label="SSH Relay User"
              type="text"
              value={remoteSshUser}
              onChange={(event) => setRemoteSshUser(event.target.value)}
              placeholder="cass"
              autoComplete="username"
              spellCheck={false}
            />
          </label>
        ) : null}
        {selectedCustomTerminal ? (
          <button
            type="button"
            className="btn btn-sm"
            onClick={openEditTerminalDialog}
          >
            Edit Terminal
          </button>
        ) : null}
        <span className="panel-description">
          Bridge: {bridgeStatus === "online" ? "Online" : "Offline"}
        </span>
        <span className="panel-description">{backendLabel}</span>
        <button
          type="button"
          className="theme-toggle"
          aria-label={themeToggleLabel}
          onClick={() =>
            setThemeMode((current) => (current === "dark" ? "light" : "dark"))
          }
        >
          <span className="theme-toggle-track" aria-hidden="true">
            <span
              className={`theme-toggle-thumb${themeMode === "light" ? " is-light" : ""}`}
            />
          </span>
          <span className="theme-toggle-copy">
            <span className="theme-toggle-label">Theme</span>
            <span className="theme-toggle-text">{themeToggleText}</span>
          </span>
        </button>
      </header>

      <aside
        className="left-sidebar"
        style={{ display: "flex", flexDirection: "column", minHeight: "0px" }}
      >
        <div
          className="sidebar-tabs"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          }}
        >
          {(["labs", "devices", "containers", "images"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`sidebar-tab${leftTab === tab ? " active" : ""}`}
              onClick={() => setLeftTab(tab)}
            >
              {tab === "labs"
                ? "Labs"
                : tab === "devices"
                  ? "Devices"
                  : tab === "containers"
                    ? "Containers"
                    : "Images"}
            </button>
          ))}
        </div>
        <div
          className="sidebar-content"
          style={{ flexGrow: 1, minHeight: "0px", overflowY: "auto" }}
        >
          <div className="sidebar-header">
            <p className="panel-eyebrow">Workspace</p>
            <h2 className="sidebar-heading">{leftPanelTitle}</h2>
            <p className="sidebar-description">{leftPanelDescription}</p>
          </div>
          {leftTab === "labs" && (
            <>
              <div className="panel-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  aria-label="Create Lab"
                  onClick={handleCreateLab}
                >
                  New Lab
                </button>
              </div>
              {createLabError ? (
                <p
                  style={{
                    color: "var(--red)",
                    padding: "0 12px",
                    fontSize: 12,
                  }}
                >
                  {createLabError}
                </p>
              ) : null}
              <LabBrowser
                labs={labs}
                selectedLabId={selectedLabId}
                onSelectLab={(labId) => {
                  setSelectedLabId(labId);
                  setSelectedNodeId(null);
                  setSelectedCableId(null);
                  setSelectedImageId(null);
                }}
                onContextMenuLab={(labId, position) => {
                  setContextMenu({
                    x: position.x,
                    y: position.y,
                    items: [
                      {
                        label: "List Backups",
                        onSelect: () => {
                          void handleOpenLabBackups(labId);
                        },
                      },
                      {
                        label: "Delete Lab",
                        onSelect: () =>
                          setConfirmState({ type: "delete-lab", labId }),
                      },
                    ],
                  });
                }}
              />
            </>
          )}
          {leftTab === "devices" && (
            <>
              <div className="panel-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={handleOpenAddNodeDialog}
                  disabled={!selectedLabId}
                >
                  Add Node
                </button>
              </div>
              <DeviceCatalog
                entries={catalog}
                onSelectTemplate={handleSelectTemplate}
                onEditTemplate={
                  api.updateTemplate
                    ? (templateId) => setEditingTemplateId(templateId)
                    : undefined
                }
              />
            </>
          )}
          {leftTab === "images" && (
            <ImageLibrary
              images={images}
              templates={catalog.map((entry) => ({
                id: entry.id,
                name: entry.name,
              }))}
              onSelectImage={(imageId) => {
                setSelectedImageId(imageId);
                setSelectedNodeId(null);
                setSelectedCableId(null);
              }}
              onUpload={async (file, templateId) => {
                if (!api.uploadImage) return;
                const image = await api.uploadImage(file);
                if (api.bindImageToTemplate && templateId) {
                  await api.bindImageToTemplate(image.id, templateId);
                }
                await refreshImages();
              }}
              onBind={async (imageId, templateId) => {
                if (!api.bindImageToTemplate) return;
                await api.bindImageToTemplate(imageId, templateId);
                await refreshImages();
              }}
              onUnbind={async (imageId) => {
                if (!api.unbindImageFromTemplate) return;
                await api.unbindImageFromTemplate(imageId);
                await refreshImages();
              }}
              onRemoveFromCatalog={async (imageId) => {
                if (!api.removeImageFromCatalog) return;
                await api.removeImageFromCatalog(imageId);
                await refreshImages();
              }}
              onDeleteImageFile={handleDeleteImageFile}
            />
          )}
          {leftTab === "containers" && (
            <ContainersTab
              api={api}
              activeLabId={selectedLabId}
              onTemplateSaved={refreshCatalog}
              onNodeCreated={(lab) => {
                applyLabUpdate(
                  lab as {
                    id: string;
                    name: string;
                    document: LabDocumentData;
                  },
                );
              }}
            />
          )}
        </div>
      </aside>

      <main className="canvas-area">
        <TopologyCanvas
          labName={selectedLab?.name ?? null}
          labId={selectedLabId}
          nodes={canvasNodes}
          networks={selectedLab?.document.networks ?? []}
          attachments={selectedLab?.document.attachments ?? []}
          nodeStatuses={nodeStatuses}
          selectedNodeId={selectedNodeId}
          onSelectNode={setSelectedNodeId}
          onSelectCable={setSelectedCableId}
          onMoveNode={async (nodeId, position) => {
            if (!selectedLabId || !api.moveNode) return;
            try {
              const lab = await api.moveNode(selectedLabId, nodeId, position);
              applyLabUpdate(lab);
            } catch {
              /* keep existing state */
            }
          }}
          onCreateNetwork={
            api.createNetwork?.bind(api) ??
            (async () => ({ network: { id: "" } }))
          }
          onAttachInterfaces={
            api.attachInterfaces?.bind(api) ?? (async () => {})
          }
          onDetachInterface={async (labId, interfaceId) => {
            if (!api.detachInterface) return;
            const lab = await api.detachInterface(labId, interfaceId);
            applyLabUpdate(lab);
          }}
          onDeleteCable={(networkId) =>
            setConfirmState({ type: "delete-cable", networkId })
          }
          onDeleteNode={(nodeId) =>
            setConfirmState({ type: "delete-node", nodeId })
          }
          onPowerOnNode={handlePowerOnNode}
          onPowerOffNode={handlePowerOffNode}
          onOpenNativeConsole={handleOpenNativeConsole}
          onRefreshLab={handleRefreshLab}
        />
      </main>

      <aside
        className="right-panel"
        style={{ minHeight: "0px", overflowY: "auto" }}
      >
        <SelectionPanel
          selected={selection}
          cloudManagementCapabilities={cloudManagementCapabilities}
          onRenameLab={handleRenameLab}
          onSetLabAutoBackup={handleSetLabAutoBackup}
          onDeleteLab={(labId) =>
            setConfirmState({ type: "delete-lab", labId })
          }
          onDeleteNode={(nodeId) =>
            setConfirmState({ type: "delete-node", nodeId })
          }
          onDeleteCable={(networkId) =>
            setConfirmState({ type: "delete-cable", networkId })
          }
          onPowerOnNode={handlePowerOnNode}
          onPowerOffNode={handlePowerOffNode}
          onEditStartupConfig={handleOpenStartupConfigDialog}
          onEditCloudSettings={handleOpenCloudNodeSettingsDialog}
          onUnbindImage={async (imageId) => {
            if (!api.unbindImageFromTemplate) return;
            await api.unbindImageFromTemplate(imageId);
            await refreshImages();
          }}
          onRemoveImageFromCatalog={async (imageId) => {
            if (!api.removeImageFromCatalog) return;
            await api.removeImageFromCatalog(imageId);
            await refreshImages();
          }}
          onDeleteImageFile={handleDeleteImageFile}
        />
        <div className="divider" />
        <LabDetails
          labName={selectedLab?.name ?? null}
          nodes={selectedLab?.document.nodes ?? []}
          nodeStatuses={nodeStatuses}
          nodeMessages={
            nativeConsoleError && selectedNodeId
              ? { ...nodeMessages, [selectedNodeId]: nativeConsoleError }
              : nodeMessages
          }
          onPowerOnNode={handlePowerOnNode}
          nodeConnectCommands={nodeConnectCommands}
          onConnectNode={handleConnectNode}
          onCopyNativeCommand={(nodeId) => {
            void handleCopyNativeCommand(nodeId);
          }}
          onDisconnectNativeConsole={(nodeId) => {
            void handleDisconnectNativeConsole(nodeId);
          }}
          nativeConsoleModeLabel={nativeConsoleModeLabel}
          selectedNodeId={selectedNodeId}
          nodeRunningConfigBackups={selectedNodeBackups}
        />
      </aside>

      <ContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        items={contextMenu?.items ?? []}
        onClose={() => setContextMenu(null)}
      />
      {startupConfigDialog ? (
        <StartupConfigDialog
          nodeId={startupConfigDialog.nodeId}
          nodeName={startupConfigDialog.nodeName}
          initialConfig={(() => {
            const doc = selectedLab?.document;
            const activeSet = doc?.startupConfigSets?.find(
              (s) => s.id === doc.activeConfigSetId,
            );
            return (
              activeSet?.nodeConfigs.find(
                (nc) => nc.nodeId === startupConfigDialog.nodeId,
              )?.config ?? ""
            );
          })()}
          initialBootActions={resolveNodeBootActions(
            startupConfigDialog.nodeId,
          )}
          onSave={handleSaveStartupConfig}
          onClose={() => setStartupConfigDialog(null)}
        />
      ) : null}
      {cloudNodeSettingsDialog ? (
        <CloudNodeSettingsDialog
          nodeId={cloudNodeSettingsDialog.nodeId}
          nodeName={cloudNodeSettingsDialog.nodeName}
          hostInterfaces={hostInterfaces}
          cloudManagementCapabilities={cloudManagementCapabilities}
          initialCloudRole={cloudNodeSettingsDialog.cloudRole}
          initialBridgeGroup={cloudNodeSettingsDialog.bridgeGroup}
          onSave={handleSaveCloudNodeSettings}
          onClose={() => setCloudNodeSettingsDialog(null)}
        />
      ) : null}
      <ConfirmDialog
        open={confirmState !== null}
        title={
          confirmState?.type === "delete-lab"
            ? "Delete Lab"
            : confirmState?.type === "delete-node"
              ? "Delete Node"
              : "Delete Cable"
        }
        body={
          confirmState?.type === "delete-lab"
            ? "This will stop running nodes, remove overlays, and delete the lab."
            : confirmState?.type === "delete-node"
              ? "This will delete the node and remove its runtime state."
              : "This will remove the cable from the lab."
        }
        onConfirm={() => {
          void handleConfirm();
        }}
        onCancel={() => setConfirmState(null)}
      />
      <ConfirmDialog
        open={restoreBackupTarget !== null}
        title="Restore Backup"
        body={
          restoreBackupTarget
            ? `Restore backup ${restoreBackupTarget.fileName} for ${restoreBackupTarget.labName}?`
            : ""
        }
        onConfirm={() => {
          if (restoreBackupTarget) {
            void handleRestoreLabBackup(
              restoreBackupTarget.labId,
              restoreBackupTarget.fileName,
            );
          }
        }}
        onCancel={() => setRestoreBackupTarget(null)}
      />
      {backupDialog ? (
        <div role="dialog" aria-label="Lab Backups" className="dialog-overlay">
          <div
            className="dialog-card dialog-card--wide"
            style={{ maxHeight: "70vh", overflowY: "auto" }}
          >
            <div className="dialog-header">
              <p className="panel-eyebrow">Backups</p>
              <h2>Lab Backups</h2>
              <p>{backupDialog.labName}</p>
            </div>
            {backupDialog.backups.length === 0 ? (
              <p>No backups found.</p>
            ) : (
              <ul
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: 0,
                  margin: 0,
                  listStyle: "none",
                }}
              >
                {backupDialog.backups.map((backup) => (
                  <li
                    key={backup.fileName}
                    className="inspector-card"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <span>{backup.fileName}</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        setRestoreBackupTarget({
                          labId: backupDialog.labId,
                          labName: backupDialog.labName,
                          fileName: backup.fileName,
                        })
                      }
                    >
                      {`Restore ${backup.fileName}`}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setBackupDialog(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {terminalDialogMode ? (
        <div
          role="dialog"
          aria-label={
            terminalDialogMode === "add" ? "Add Terminal" : "Edit Terminal"
          }
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "grid",
            placeItems: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 8,
              padding: 16,
              width: 420,
            }}
          >
            <h2>
              {terminalDialogMode === "add" ? "Add Terminal" : "Edit Terminal"}
            </h2>
            <label className="field" style={{ marginBottom: 8 }}>
              <span className="field-label">Terminal Name</span>
              <input
                className="field-input"
                aria-label="Terminal Name"
                value={newTerminalName}
                onChange={(event) => setNewTerminalName(event.target.value)}
              />
            </label>
            <label className="field" style={{ marginBottom: 12 }}>
              <span className="field-label">Terminal Command Template</span>
              <input
                className="field-input"
                aria-label="Terminal Command Template"
                value={newTerminalTemplate}
                onChange={(event) => setNewTerminalTemplate(event.target.value)}
              />
            </label>
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              {terminalDialogMode === "edit" ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={handleDeleteTerminal}
                >
                  Delete Terminal
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setTerminalDialogMode(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleSaveTerminal}
              >
                Save Terminal
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {consoleNode && selectedLabId ? (
        <Suspense fallback={null}>
          <NodeConsole
            labId={selectedLabId}
            nodeId={consoleNode.nodeId}
            nodeName={consoleNode.nodeName}
            onClose={() => setConsoleNode(null)}
          />
        </Suspense>
      ) : null}
      {showAddNodeDialog ? (
        <AddNodeDialog
          templates={
            dialogTemplateId
              ? [
                  {
                    id: dialogTemplateId,
                    name:
                      catalog.find((c) => c.id === dialogTemplateId)?.name ??
                      dialogTemplateId,
                    source: "",
                    runtime: catalog.find((c) => c.id === dialogTemplateId)
                      ?.runtime,
                    configSchema: catalog.find((c) => c.id === dialogTemplateId)
                      ?.configSchema,
                  },
                ]
              : catalog
          }
          existingNodes={selectedLab?.document.nodes ?? []}
          hostInterfaces={hostInterfaces}
          cloudManagementCapabilities={cloudManagementCapabilities}
          onSubmit={handleAddNode}
          onCancel={() => {
            setShowAddNodeDialog(false);
            setDialogTemplateId(null);
          }}
        />
      ) : null}
      {editingTemplate ? (
        <TemplateEditorDialog
          key={editingTemplate.id}
          template={editingTemplate}
          onSubmit={async (input) => {
            if (!api.updateTemplate) {
              throw new Error("Template updates unavailable");
            }
            const nextTemplate = await api.updateTemplate(
              editingTemplate.id,
              input,
            );
            applyTemplateUpdate(nextTemplate);
            setEditingTemplateId(null);
          }}
          onCancel={() => setEditingTemplateId(null)}
        />
      ) : null}
    </div>
  );
}
