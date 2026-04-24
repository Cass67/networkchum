import type { ImportFormat, ImportIssue } from "@networkchum/shared";

export type TopologyUpload = {
  fileName: string;
  content: Buffer;
};

export type TopologyPayload = {
  format: ImportFormat;
  originalFileName: string;
  topologyPath: string;
  content: string;
  ignoredFiles: string[];
};

export type NormalizedImportedNode = {
  foreignId: string;
  name: string;
  templateName: string | null;
  imageName: string | null;
  runtimeHint: "qemu" | "container" | "cloud" | null;
  position: { x: number; y: number };
  ramMb?: number;
  vcpu?: number;
  interfaceNames: string[];
  startupConfig?: string;
};

export type NormalizedImportedLink = {
  sourceNodeId: string;
  sourceInterface: string;
  targetNodeId: string;
  targetInterface: string;
  networkName?: string;
};

export type NormalizedImportedTopology = {
  source: {
    format: ImportFormat;
    fileName: string;
    topologyPath: string;
  };
  name: string;
  nodes: NormalizedImportedNode[];
  links: NormalizedImportedLink[];
  issues: ImportIssue[];
};
