import type {
  CloudRole,
  NodeBootAction,
  NodeBootActionState,
} from "@networkchum/shared";

type LabSummary = {
  id: string;
  name: string;
  autoBackup?: boolean;
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
  nodes: Array<{
    id: string;
    name: string;
    runtime?: string;
    position?: { x: number; y: number };
    interfaces?: Array<{ id: string; name: string; slot: number }>;
    config?: {
      cloudRole?: CloudRole;
      bridgeGroup?: string | null;
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
    configSchema: template.configSchema,
  };
}

export function createApiClient(fetcher: Fetcher, baseUrl = "/api") {
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
        }>;
      }>(response as Response);

      return payload.entries.map((entry) => ({
        ...mapTemplateSummary(entry.template),
        source: entry.source,
      }));
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

    async getLab(labId: string): Promise<LabDetails> {
      const response = await fetcher(`${baseUrl}/labs/${labId}`);
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
        interfaceCount?: number;
        cloudRole?: CloudRole;
        bridgeGroup?: string | null;
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
