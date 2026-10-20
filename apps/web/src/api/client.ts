import type {
  AiLabCommitRequest,
  AiLabPreview,
  AiProviderKind,
  AiProviderSettings,
  AiProviderSettingsView,
  CanvasDrawing,
  CloudRole,
  ImportCommitRequest,
  ImportPreview,
  NodeBootAction,
  NodeBootActionState,
} from "@networkchum/shared";

type LabSummary = {
  id: string;
  name: string;
  autoBackup?: boolean;
};

export type ContainerEngine = "docker" | "podman";

export type LocalContainerImageSummary = {
  id: string;
  imageRef: string;
  repository: string;
  tag: string;
  size?: string;
};

export type ContainerSearchResultSummary = {
  registry: string;
  imageRef: string;
  repository: string;
  description?: string;
  stars?: number;
};

type LabBackupSummary = {
  fileName: string;
};

export type RunningConfigBackupRecord = {
  id: string;
  labId: string;
  nodeId: string;
  status: "captured" | "failed" | "unsupported";
  source: string;
  createdAt: string;
};

type CatalogSummary = {
  id: string;
  name: string;
  source: string;
  vendor?: string;
  runtime?: string;
  deviceRoleIcon?: DeviceRoleIcon;
  imageId?: string | null;
  imageName?: string | null;
  container?: {
    imageRef: string;
    registry: string;
    engine?: ContainerEngine;
    defaultShell?: string;
  };
  configSchema?: {
    ramMb: { default: number; min: number; max: number };
    vcpu: { default: number; min: number; max: number };
    interfaceCount: { default: number; min: number; max: number };
  };
};

type TemplateSummary = {
  id: string;
  name: string;
  vendor?: string;
  runtime?: string;
  deviceRoleIcon?: DeviceRoleIcon;
  container?: {
    imageRef: string;
    registry: string;
    engine?: ContainerEngine;
    defaultShell?: string;
  };
  configSchema?: {
    ramMb: { default: number; min: number; max: number };
    vcpu: { default: number; min: number; max: number };
    interfaceCount: { default: number; min: number; max: number };
  };
};

type ImageRecordSummary = {
  id: string;
  name: string;
  templateId: string | null;
  suggestedTemplateId?: string | null;
  source: string;
  catalogState: string;
};

type StartupConfigSetSummary = {
  id: string;
  name: string;
  nodeConfigs: Array<{ nodeId: string; config: string }>;
};

type LabDocumentSummary = {
  canvas?: {
    zoom?: number;
    backgroundImage?: string | null;
    drawings?: CanvasDrawing[];
  };
  nodes: Array<{
    id: string;
    name: string;
    templateId?: string | null;
    runtime?: string;
    position?: { x: number; y: number };
    interfaces?: Array<{ id: string; name: string; slot: number }>;
    config?: {
      cloudRole?: CloudRole;
      bridgeGroup?: string | null;
      containerImageRef?: string;
      containerRegistry?: string;
      containerEngine?: ContainerEngine;
      containerShell?: string;
    };
    state?: { desiredPower: string };
  }>;
  networks: Array<{ id: string; kind: string; name: string; visible: boolean }>;
  attachments: Array<{ interfaceId: string; networkId: string }>;
  startupConfigSets?: StartupConfigSetSummary[];
  nodeBootActions?: NodeBootActionState[];
  activeConfigSetId?: string | null;
};

type LabDetails = {
  id: string;
  name: string;
  autoBackup?: boolean;
  document: LabDocumentSummary;
};

type RuntimeState = {
  nodeId: string;
  status: string;
  connectCommand?: string[];
  message?: string | null;
};

type Fetcher = typeof fetch;

export const API_TOKEN_STORAGE_KEY = "networkchum-api-token";
export const API_TOKEN_HEADER = "x-networkchum-token";

let onTokenRequired: (() => void) | null = null;

// Register a handler invoked whenever an API call comes back 401 (token
// missing or wrong). Returns a disposer.
export function setOnTokenRequired(handler: () => void): () => void {
  onTokenRequired = handler;
  return () => {
    if (onTokenRequired === handler) {
      onTokenRequired = null;
    }
  };
}

export function getStoredApiToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.localStorage?.getItem(API_TOKEN_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredApiToken(token: string): void {
  try {
    window.localStorage?.setItem(API_TOKEN_STORAGE_KEY, token.trim());
  } catch {
    // Storage failures leave the token in memory only; the next call fails.
  }
}

type DeviceRoleIcon =
  | "router"
  | "switch"
  | "firewall"
  | "cloud"
  | "host"
  | "client";

type TemplatePayload = {
  id: string;
  displayName: string;
  vendor: string;
  runtime: string;
  deviceRoleIcon?: DeviceRoleIcon;
  container?: {
    imageRef: string;
    registry: string;
    engine?: ContainerEngine;
    defaultShell?: string;
  };
  configSchema: {
    ramMb: { default: number; min: number; max: number };
    vcpu: { default: number; min: number; max: number };
    interfaceCount: { default: number; min: number; max: number };
  };
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function mapTemplateSummary(template: TemplatePayload) {
  return {
    id: template.id,
    name: template.displayName,
    vendor: template.vendor,
    runtime: template.runtime,
    deviceRoleIcon: template.deviceRoleIcon,
    container: template.container,
    configSchema: template.configSchema,
  };
}

export function createApiClient(rawFetcher: Fetcher, baseUrl = "/api") {
  const fetcher: Fetcher = async (input, init) => {
    let callInit: RequestInit | undefined = init;
    if (getStoredApiToken()) {
      const headers = new Headers(init?.headers);
      headers.set(API_TOKEN_HEADER, getStoredApiToken());
      callInit = { ...init, headers };
    }

    const response =
      callInit === undefined
        ? await rawFetcher(input)
        : await rawFetcher(input, callInit);
    if (response.status === 401) {
      onTokenRequired?.();
    }
    return response;
  };
  return {
    async listLabs(): Promise<LabSummary[]> {
      const response = await fetcher(`${baseUrl}/labs`);
      const payload = await parseResponse<{ labs: LabSummary[] }>(
        response as Response,
      );
      return payload.labs;
    },

    async listCatalog(): Promise<CatalogSummary[]> {
      const response = await fetcher(`${baseUrl}/catalog`);
      const payload = await parseResponse<{
        entries: Array<{
          id: string;
          source: string;
          template: TemplatePayload;
          image?: { id?: string; name?: string } | null;
        }>;
      }>(response as Response);

      return payload.entries.map((entry) => ({
        ...mapTemplateSummary(entry.template),
        source: entry.source,
        imageId: entry.image?.id ?? null,
        imageName: entry.image?.name ?? null,
      }));
    },

    async listTemplates(): Promise<TemplateSummary[]> {
      const response = await fetcher(`${baseUrl}/templates`);
      const payload = await parseResponse<{
        templates: TemplatePayload[];
      }>(response as Response);

      return payload.templates.map((template) => mapTemplateSummary(template));
    },

    async getContainerRuntime(): Promise<{
      engine: ContainerEngine | null;
      available: boolean;
      message: string | null;
    }> {
      const response = await fetcher(`${baseUrl}/containers/runtime`);
      return parseResponse(response as Response);
    },

    async listContainerImages(): Promise<{
      engine: ContainerEngine | null;
      images: LocalContainerImageSummary[];
      message: string | null;
    }> {
      const response = await fetcher(`${baseUrl}/containers/images`);
      return parseResponse(response as Response);
    },

    async searchContainerImages(
      registry: string,
      query: string,
    ): Promise<ContainerSearchResultSummary[]> {
      const url = new URL(`${baseUrl}/containers/search`, "http://localhost");
      url.searchParams.set("registry", registry);
      url.searchParams.set("query", query);
      const response = await fetcher(`${url.pathname}${url.search}`);
      const payload = await parseResponse<{
        registry: string;
        results: ContainerSearchResultSummary[];
      }>(response as Response);
      return payload.results;
    },

    async pullContainerImage(
      registry: string,
      imageRef: string,
    ): Promise<{
      engine: ContainerEngine;
      imageRef: string;
      image: LocalContainerImageSummary | null;
    }> {
      const response = await fetcher(`${baseUrl}/containers/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ registry, imageRef }),
      });
      return parseResponse(response as Response);
    },

    async saveContainerTemplate(input: {
      displayName: string;
      imageRef: string;
      registry: string;
      shell?: string;
    }): Promise<CatalogSummary> {
      const response = await fetcher(`${baseUrl}/containers/templates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await parseResponse<{ template: TemplatePayload }>(
        response as Response,
      );
      return {
        ...mapTemplateSummary(payload.template),
        source: "built-in",
      };
    },

    async createLab(name: string): Promise<LabSummary> {
      const response = await fetcher(`${baseUrl}/labs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
      const payload = await parseResponse<{ lab: LabSummary }>(
        response as Response,
      );
      return payload.lab;
    },

    async renameLab(labId: string, name: string): Promise<LabDetails> {
      const response = await fetcher(`${baseUrl}/labs/${labId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ name }),
      });
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async setLabAutoBackup(
      labId: string,
      autoBackup: boolean,
    ): Promise<LabDetails> {
      const response = await fetcher(`${baseUrl}/labs/${labId}/auto-backup`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoBackup }),
      });
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async listLabBackups(labId: string): Promise<LabBackupSummary[]> {
      const response = await fetcher(`${baseUrl}/labs/${labId}/backups`);
      const payload = await parseResponse<{ backups: LabBackupSummary[] }>(
        response as Response,
      );
      return payload.backups;
    },

    async restoreLabBackup(
      labId: string,
      fileName: string,
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/restore-backup`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileName }),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async deleteLab(labId: string): Promise<{ labId: string }> {
      const response = await fetcher(`${baseUrl}/labs/${labId}`, {
        method: "DELETE",
      });
      return parseResponse(response as Response);
    },

    async previewTopologyImport(file: File): Promise<ImportPreview> {
      const body = new FormData();
      body.append("file", file);
      const response = await fetcher(`${baseUrl}/imports/topology/preview`, {
        method: "POST",
        body,
      });
      const payload = await parseResponse<{ preview: ImportPreview }>(
        response as Response,
      );
      return payload.preview;
    },

    async commitTopologyImport(
      draftId: string,
      input: ImportCommitRequest,
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/imports/topology/${draftId}/commit`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async getLab(labId: string): Promise<LabDetails> {
      const response = await fetcher(`${baseUrl}/labs/${labId}`);
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async getAiProvider(): Promise<AiProviderSettingsView | null> {
      const response = await fetcher(`${baseUrl}/ai/provider`);
      const payload = await parseResponse<{
        provider: AiProviderSettingsView | null;
      }>(response as Response);
      return payload.provider;
    },

    async saveAiProvider(
      settings: AiProviderSettings,
    ): Promise<AiProviderSettingsView> {
      const response = await fetcher(`${baseUrl}/ai/provider`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload = await parseResponse<{
        provider: AiProviderSettingsView;
      }>(response as Response);
      return payload.provider;
    },

    async probeAiModels(input: {
      provider: AiProviderKind;
      baseUrl: string;
      apiKey?: string | null;
    }): Promise<{ models: Array<string> }> {
      const response = await fetcher(`${baseUrl}/ai/provider/probe`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await parseResponse<{ models: Array<string> }>(
        response as Response,
      );
      return payload;
    },

    async previewAiLab(
      prompt: string,
      devices: Array<string> = [],
    ): Promise<AiLabPreview> {
      const response = await fetcher(`${baseUrl}/ai/labs/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          devices.length > 0 ? { prompt, devices } : { prompt },
        ),
      });
      const payload = await parseResponse<{ preview: AiLabPreview }>(
        response as Response,
      );
      return payload.preview;
    },

    async commitAiLab(input: AiLabCommitRequest): Promise<LabDetails> {
      const response = await fetcher(`${baseUrl}/ai/labs/commit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async deleteNode(labId: string, nodeId: string): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/nodes/${nodeId}`,
        {
          method: "DELETE",
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async deleteCable(labId: string, networkId: string): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/networks/${networkId}`,
        {
          method: "DELETE",
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async addNode(
      labId: string,
      input: {
        templateId: string;
        name: string;
        position: { x: number; y: number };
        imageId?: string | null;
        interfaceCount?: number;
        cloudRole?: CloudRole;
        bridgeGroup?: string | null;
        peerLabId?: string;
      },
    ): Promise<LabDetails> {
      const response = await fetcher(`${baseUrl}/labs/${labId}/nodes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async createContainerNode(
      labId: string,
      input: {
        displayName: string;
        imageRef: string;
        registry: string;
        shell?: string;
      },
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/container-nodes`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async powerOnNode(labId: string, nodeId: string): Promise<RuntimeState> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/nodes/${nodeId}/power-on`,
        {
          method: "POST",
        },
      );
      const payload = await parseResponse<{ state: RuntimeState }>(
        response as Response,
      );
      return payload.state;
    },

    async powerOffNode(labId: string, nodeId: string): Promise<RuntimeState> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/nodes/${nodeId}/power-off`,
        {
          method: "POST",
        },
      );
      const payload = await parseResponse<{ state: RuntimeState }>(
        response as Response,
      );
      return payload.state;
    },

    async listRuntimeStates(labId: string): Promise<RuntimeState[]> {
      const response = await fetcher(`${baseUrl}/labs/${labId}/runtime`);
      const payload = await parseResponse<{ states: RuntimeState[] }>(
        response as Response,
      );
      return payload.states;
    },

    async listHostInterfaces(): Promise<string[]> {
      const response = await fetcher(`${baseUrl}/host/interfaces`);
      const payload = await parseResponse<{ interfaces: string[] }>(
        response as Response,
      );
      return payload.interfaces;
    },

    async listRunningConfigBackups(
      labId: string,
      nodeId: string,
    ): Promise<RunningConfigBackupRecord[]> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/nodes/${nodeId}/running-config-backups`,
      );
      const payload = await parseResponse<{
        backups: RunningConfigBackupRecord[];
      }>(response as Response);
      return payload.backups;
    },

    async listImages(): Promise<ImageRecordSummary[]> {
      const response = await fetcher(`${baseUrl}/images`);
      const payload = await parseResponse<{ images: ImageRecordSummary[] }>(
        response as Response,
      );
      return payload.images;
    },

    async uploadImage(file: File): Promise<ImageRecordSummary> {
      const body = new FormData();
      body.append("file", file);
      const response = await fetcher(`${baseUrl}/images/upload`, {
        method: "POST",
        body,
      });
      const payload = await parseResponse<{ image: ImageRecordSummary }>(
        response as Response,
      );
      return payload.image;
    },

    async bindImageToTemplate(
      imageId: string,
      templateId: string,
    ): Promise<ImageRecordSummary> {
      const response = await fetcher(
        `${baseUrl}/images/${imageId}/bind-template`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ templateId }),
        },
      );
      const payload = await parseResponse<{ image: ImageRecordSummary }>(
        response as Response,
      );
      return payload.image;
    },

    async unbindImageFromTemplate(
      imageId: string,
    ): Promise<ImageRecordSummary> {
      const response = await fetcher(
        `${baseUrl}/images/${imageId}/template-binding`,
        {
          method: "DELETE",
        },
      );
      const payload = await parseResponse<{ image: ImageRecordSummary }>(
        response as Response,
      );
      return payload.image;
    },

    async removeImageFromCatalog(imageId: string): Promise<ImageRecordSummary> {
      const response = await fetcher(`${baseUrl}/images/${imageId}`, {
        method: "DELETE",
      });
      const payload = await parseResponse<{ image: ImageRecordSummary }>(
        response as Response,
      );
      return payload.image;
    },

    async deleteImageFile(imageId: string): Promise<ImageRecordSummary> {
      const response = await fetcher(`${baseUrl}/images/${imageId}/file`, {
        method: "DELETE",
      });
      const payload = await parseResponse<{ image: ImageRecordSummary }>(
        response as Response,
      );
      return payload.image;
    },

    async updateTemplate(
      templateId: string,
      input: {
        vcpu: number;
        ramMb: number;
        interfaceCount: number;
        deviceRoleIcon?: DeviceRoleIcon;
      },
    ): Promise<ReturnType<typeof mapTemplateSummary>> {
      const response = await fetcher(`${baseUrl}/templates/${templateId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
      const payload = await parseResponse<{ template: TemplatePayload }>(
        response as Response,
      );
      return mapTemplateSummary(payload.template);
    },

    async createNetwork(
      labId: string,
      input: { name: string; visible?: boolean },
    ): Promise<{
      network: { id: string; kind: string; name: string; visible: boolean };
      lab: LabDetails;
    }> {
      const response = await fetcher(`${baseUrl}/labs/${labId}/networks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await parseResponse<{
        network: { id: string; kind: string; name: string; visible: boolean };
        lab: LabDetails;
      }>(response as Response);
      return payload;
    },

    async attachInterfaces(
      labId: string,
      input: { networkId: string; interfaceIds: string[] },
    ): Promise<LabDetails> {
      const response = await fetcher(`${baseUrl}/labs/${labId}/attachments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async updateCanvasDrawings(
      labId: string,
      drawings: CanvasDrawing[],
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/canvas/drawings`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ drawings }),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async moveNode(
      labId: string,
      nodeId: string,
      position: { x: number; y: number },
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/nodes/${nodeId}/position`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(position),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async moveNodes(
      labId: string,
      moves: Array<{ nodeId: string; position: { x: number; y: number } }>,
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/nodes/positions`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ moves }),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async renameNode(
      labId: string,
      nodeId: string,
      name: string,
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/nodes/${nodeId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async detachInterface(
      labId: string,
      interfaceId: string,
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/attachments/${interfaceId}`,
        {
          method: "DELETE",
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async createConfigSet(
      labId: string,
      name: string,
    ): Promise<{ configSet: StartupConfigSetSummary; lab: LabDetails }> {
      const response = await fetcher(`${baseUrl}/labs/${labId}/config-sets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      return parseResponse<{
        configSet: StartupConfigSetSummary;
        lab: LabDetails;
      }>(response as Response);
    },

    async setActiveConfigSet(
      labId: string,
      activeConfigSetId: string | null,
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/active-config-set`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ activeConfigSetId }),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async setNodeConfig(
      labId: string,
      setId: string,
      nodeId: string,
      config: string,
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/config-sets/${setId}/nodes/${nodeId}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ config }),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async setNodeBootAction(
      labId: string,
      nodeId: string,
      actions: {
        startupConfig: NodeBootAction;
        runningConfigBackup: NodeBootAction;
      },
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/nodes/${nodeId}/boot-action`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(actions),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },

    async setNodeSettings(
      labId: string,
      nodeId: string,
      settings: { cloudRole?: CloudRole; bridgeGroup?: string | null },
    ): Promise<LabDetails> {
      const response = await fetcher(
        `${baseUrl}/labs/${labId}/nodes/${nodeId}/settings`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(settings),
        },
      );
      const payload = await parseResponse<{ lab: LabDetails }>(
        response as Response,
      );
      return payload.lab;
    },
  };
}
