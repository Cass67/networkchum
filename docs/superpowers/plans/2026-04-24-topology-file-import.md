# Topology File Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import EVE-NG, PNETLab, and GNS3 lab files into NetworkChum, with an explicit substitution step when a referenced device type or image is not available locally.

**Architecture:** Add an API-side importer pipeline that parses uploaded topology files into a normalized import draft, matches foreign node/image references against NetworkChum templates and image bindings, then commits the draft into a normal `LabDocument` only after unresolved mappings are supplied. The web UI gets a lightweight import dialog with file upload, preview, mapping rows, and final import. Live-server import is intentionally left as a future adapter that can feed the same normalized draft model.

**Tech Stack:** TypeScript, Fastify multipart routes, Zod schemas in `@networkchum/shared`, `fast-xml-parser` for `.unl`, `jszip` for packaged imports, Vitest, React.

---

## File Structure

- Create: `packages/shared/src/importTopology.ts`
  - Shared Zod schemas and types for import preview, mapping candidates, commit resolutions, and imported lab summaries.
- Modify: `packages/shared/src/index.ts`
  - Export import topology types.
- Create: `apps/api/src/importers/types.ts`
  - API internal normalized topology types and parser interfaces.
- Create: `apps/api/src/importers/normalize.ts`
  - Common helpers for IDs, positions, interface names, network construction, and foreign-key grouping.
- Create: `apps/api/src/importers/eveUnlParser.ts`
  - Parse EVE-NG and PNETLab `.unl` XML files into the normalized model.
- Create: `apps/api/src/importers/gns3Parser.ts`
  - Parse GNS3 `.gns3` JSON files into the normalized model.
- Create: `apps/api/src/importers/packageReader.ts`
  - Read uploaded plain files and zip-style packages, identify the contained topology file, and return its content.
- Create: `apps/api/src/importers/deviceMatcher.ts`
  - Match normalized foreign nodes to local catalog/templates/images and produce required substitution choices.
- Create: `apps/api/src/importers/importDraftStore.ts`
  - Persist normalized drafts in `import-drafts.json` without retaining raw uploaded files.
- Create: `apps/api/src/importers/commitImport.ts`
  - Convert a resolved draft into a `LabDocument` and create the lab record.
- Create: `apps/api/src/importers/importTopology.test.ts`
  - API importer unit tests covering `.unl`, PNETLab aliasing, `.gns3`, mapping, and commit.
- Modify: `apps/api/package.json`
  - Add `fast-xml-parser` and `jszip`.
- Modify: `apps/api/src/app.ts`
  - Register import routes.
- Create: `apps/api/src/routes/imports.ts`
  - `POST /imports/topology/preview` and `POST /imports/topology/:draftId/commit`.
- Modify: `apps/api/src/labs/labStore.ts`
  - Add `createLabFromDocument`.
- Modify: `apps/api/src/app.test.ts`
  - Add route-level tests for preview and commit.
- Modify: `apps/web/src/api/client.ts`
  - Add import preview and commit methods and exported import types.
- Create: `apps/web/src/components/ImportTopologyDialog.tsx`
  - File upload, preview, required substitutions, and import action.
- Create: `apps/web/src/components/ImportTopologyDialog.test.tsx`
  - UI tests for preview, mapping, validation, and commit.
- Modify: `apps/web/src/components/LabBrowser.tsx`
  - Add an `Import Lab` button entry point.
- Modify: `apps/web/src/App.tsx`
  - Wire dialog state, client calls, and select the imported lab after commit.
- Modify: `apps/web/src/theme.css`
  - Import dialog layout and mapping table styles.
- Modify: `README.md`
  - Document supported import formats and first-pass limitations.

## External Format Notes

- GNS3 `.gns3` files are JSON topology documents; `.gns3project` and `.gns3p` are zipped project packages containing a `.gns3` file.
- EVE-NG and PNETLab lab files are XML `.unl` files. PNETLab is treated as the same parser family for MVP.
- Packaged imports can contain images and workbooks. MVP reads only the lab topology file and reports ignored package contents.

## Task 1: Shared Import Contract

**Files:**

- Create: `packages/shared/src/importTopology.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/importTopology.test.ts`

- [ ] **Step 1: Write failing shared schema tests**

Create `packages/shared/src/importTopology.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  ImportPreviewSchema,
  ImportCommitRequestSchema,
} from "./importTopology.js";

describe("import topology schemas", () => {
  it("accepts an import preview with unresolved mappings", () => {
    const preview = ImportPreviewSchema.parse({
      draftId: "draft-1",
      source: { format: "eve-unl", fileName: "lab.unl" },
      labName: "Imported Lab",
      summary: { nodes: 2, networks: 1, links: 1 },
      nodes: [
        {
          foreignId: "1",
          name: "R1",
          templateKey: "qemu:cisco-vios:vios-adventerprisek9",
          requestedTemplate: "vios",
          requestedImage: "vios-adventerprisek9",
          status: "unresolved",
          candidates: [{ templateId: "cisco-iosv", label: "Cisco IOSv" }],
        },
      ],
      issues: [{ severity: "warning", message: "Workbook ignored" }],
    });

    expect(preview.nodes[0]?.status).toBe("unresolved");
  });

  it("accepts commit mappings keyed by template key", () => {
    const request = ImportCommitRequestSchema.parse({
      name: "Imported Lab",
      mappings: [
        {
          templateKey: "qemu:cisco-vios:vios-adventerprisek9",
          templateId: "cisco-iosv",
          imageId: "img-1",
        },
      ],
    });

    expect(request.mappings[0]?.imageId).toBe("img-1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/shared -- src/importTopology.test.ts
```

Expected: FAIL because `importTopology.ts` does not exist.

- [ ] **Step 3: Add shared schemas**

Create `packages/shared/src/importTopology.ts`:

```ts
import { z } from "zod";

export const ImportFormatSchema = z.enum([
  "eve-unl",
  "pnetlab-unl",
  "gns3",
  "gns3-project",
]);

export const ImportIssueSchema = z.object({
  severity: z.enum(["info", "warning", "error"]),
  message: z.string().min(1),
  nodeName: z.string().min(1).optional(),
});

export const ImportCandidateSchema = z.object({
  templateId: z.string().min(1),
  imageId: z.string().min(1).nullable().optional(),
  label: z.string().min(1),
  reason: z.string().min(1).optional(),
});

export const ImportPreviewNodeSchema = z.object({
  foreignId: z.string().min(1),
  name: z.string().min(1),
  templateKey: z.string().min(1),
  requestedTemplate: z.string().min(1).nullable(),
  requestedImage: z.string().min(1).nullable(),
  status: z.enum(["matched", "unresolved"]),
  matchedTemplateId: z.string().min(1).nullable().optional(),
  matchedImageId: z.string().min(1).nullable().optional(),
  candidates: z.array(ImportCandidateSchema),
});

export const ImportPreviewSchema = z.object({
  draftId: z.string().min(1),
  source: z.object({
    format: ImportFormatSchema,
    fileName: z.string().min(1),
    topologyPath: z.string().min(1).optional(),
  }),
  labName: z.string().min(1),
  summary: z.object({
    nodes: z.number().int().nonnegative(),
    networks: z.number().int().nonnegative(),
    links: z.number().int().nonnegative(),
  }),
  nodes: z.array(ImportPreviewNodeSchema),
  issues: z.array(ImportIssueSchema),
});

export const ImportMappingSchema = z.object({
  templateKey: z.string().min(1),
  templateId: z.string().min(1),
  imageId: z.string().min(1).nullable().optional(),
});

export const ImportCommitRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
  mappings: z.array(ImportMappingSchema).default(() => []),
});

export type ImportFormat = z.infer<typeof ImportFormatSchema>;
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
export type ImportPreviewNode = z.infer<typeof ImportPreviewNodeSchema>;
export type ImportCommitRequest = z.infer<typeof ImportCommitRequestSchema>;
export type ImportMapping = z.infer<typeof ImportMappingSchema>;
export type ImportIssue = z.infer<typeof ImportIssueSchema>;
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./catalog.js";
export * from "./importTopology.js";
export * from "./networkAccess.js";
export * from "./topology.js";
```

- [ ] **Step 4: Run shared tests**

Run:

```bash
npm run test --workspace @networkchum/shared -- src/importTopology.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/importTopology.ts packages/shared/src/importTopology.test.ts packages/shared/src/index.ts
git commit -m "feat: add topology import contract"
```

## Task 2: Package Reader and Parser Interfaces

**Files:**

- Modify: `apps/api/package.json`
- Create: `apps/api/src/importers/types.ts`
- Create: `apps/api/src/importers/packageReader.ts`
- Test: `apps/api/src/importers/packageReader.test.ts`

- [ ] **Step 1: Add dependencies**

Run:

```bash
npm install --workspace @networkchum/api fast-xml-parser jszip
```

Expected: `apps/api/package.json` and `package-lock.json` update.

- [ ] **Step 2: Write failing package reader tests**

Create `apps/api/src/importers/packageReader.test.ts`:

```ts
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { readTopologyUpload } from "./packageReader.js";

describe("readTopologyUpload", () => {
  it("reads a plain EVE unl file", async () => {
    const result = await readTopologyUpload({
      fileName: "demo.unl",
      content: Buffer.from("<lab><topology /></lab>"),
    });

    expect(result.format).toBe("eve-unl");
    expect(result.topologyPath).toBe("demo.unl");
  });

  it("reads a gns3 file from a project zip", async () => {
    const zip = new JSZip();
    zip.file("project-files/demo.gns3", JSON.stringify({ name: "demo" }));
    const content = Buffer.from(
      await zip.generateAsync({ type: "uint8array" }),
    );

    const result = await readTopologyUpload({
      fileName: "demo.gns3project",
      content,
    });

    expect(result.format).toBe("gns3-project");
    expect(result.topologyPath).toBe("project-files/demo.gns3");
  });

  it("rejects packages with multiple topology files", async () => {
    const zip = new JSZip();
    zip.file("a.unl", "<lab />");
    zip.file("b.unl", "<lab />");
    const content = Buffer.from(
      await zip.generateAsync({ type: "uint8array" }),
    );

    await expect(
      readTopologyUpload({ fileName: "many.zip", content }),
    ).rejects.toThrow(/multiple topology files/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/importers/packageReader.test.ts
```

Expected: FAIL because the reader does not exist.

- [ ] **Step 4: Add importer types and package reader**

Create `apps/api/src/importers/types.ts`:

```ts
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
```

Create `apps/api/src/importers/packageReader.ts`:

```ts
import path from "node:path";

import JSZip from "jszip";
import type { ImportFormat } from "@networkchum/shared";

import type { TopologyPayload, TopologyUpload } from "./types.js";

function extensionOf(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

function formatForPath(
  fileName: string,
  packageFileName?: string,
): ImportFormat | null {
  const ext = extensionOf(fileName);
  if (ext === ".unl") {
    return /pnet/i.test(packageFileName ?? fileName)
      ? "pnetlab-unl"
      : "eve-unl";
  }
  if (ext === ".gns3") {
    return packageFileName ? "gns3-project" : "gns3";
  }
  return null;
}

export async function readTopologyUpload(
  upload: TopologyUpload,
): Promise<TopologyPayload> {
  const directFormat = formatForPath(upload.fileName);
  if (directFormat) {
    return {
      format: directFormat,
      originalFileName: upload.fileName,
      topologyPath: upload.fileName,
      content: upload.content.toString("utf8"),
      ignoredFiles: [],
    };
  }

  const ext = extensionOf(upload.fileName);
  if (![".zip", ".gns3project", ".gns3p"].includes(ext)) {
    throw new Error(
      "Unsupported import file. Upload .unl, .gns3, .zip, .gns3project, or .gns3p.",
    );
  }

  const zip = await JSZip.loadAsync(upload.content);
  const candidates = Object.values(zip.files).filter((entry) => {
    if (entry.dir) return false;
    return Boolean(formatForPath(entry.name, upload.fileName));
  });

  if (candidates.length === 0) {
    throw new Error("Package does not contain a supported topology file.");
  }
  if (candidates.length > 1) {
    throw new Error(
      "Package contains multiple topology files. Import one lab at a time.",
    );
  }

  const entry = candidates[0]!;
  const format = formatForPath(entry.name, upload.fileName)!;
  return {
    format,
    originalFileName: upload.fileName,
    topologyPath: entry.name,
    content: await entry.async("text"),
    ignoredFiles: Object.values(zip.files)
      .filter((file) => !file.dir && file.name !== entry.name)
      .map((file) => file.name),
  };
}
```

- [ ] **Step 5: Run package reader tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/importers/packageReader.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json package-lock.json apps/api/src/importers/types.ts apps/api/src/importers/packageReader.ts apps/api/src/importers/packageReader.test.ts
git commit -m "feat: read topology import packages"
```

## Task 3: EVE-NG and PNETLab `.unl` Parser

**Files:**

- Create: `apps/api/src/importers/eveUnlParser.ts`
- Modify: `apps/api/src/importers/types.ts`
- Test: `apps/api/src/importers/eveUnlParser.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `apps/api/src/importers/eveUnlParser.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseEveUnlTopology } from "./eveUnlParser.js";

const unl = `
<lab name="OSPF Lab">
  <topology>
    <nodes>
      <node id="1" name="R1" type="qemu" template="vios" image="vios-adventerprisek9" left="100" top="200" ram="1024" ethernet="2">
        <interfaces>
          <interface id="0" name="Gi0/0" type="ethernet" network_id="1" />
          <interface id="1" name="Gi0/1" type="ethernet" network_id="2" />
        </interfaces>
        <configs>
          <config id="0">hostname R1</config>
        </configs>
      </node>
      <node id="2" name="R2" type="qemu" template="vios" image="vios-adventerprisek9" left="300" top="200" ethernet="1">
        <interfaces>
          <interface id="0" name="Gi0/0" type="ethernet" network_id="1" />
        </interfaces>
      </node>
    </nodes>
    <networks>
      <network id="1" type="bridge" name="net1" />
      <network id="2" type="bridge" name="stub" />
    </networks>
  </topology>
</lab>`;

describe("parseEveUnlTopology", () => {
  it("normalizes nodes, positions, interfaces, links, and startup config", () => {
    const result = parseEveUnlTopology({
      format: "eve-unl",
      originalFileName: "ospf.unl",
      topologyPath: "ospf.unl",
      content: unl,
      ignoredFiles: [],
    });

    expect(result.name).toBe("OSPF Lab");
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toMatchObject({
      name: "R1",
      templateName: "vios",
      imageName: "vios-adventerprisek9",
      position: { x: 100, y: 200 },
      ramMb: 1024,
      interfaceNames: ["Gi0/0", "Gi0/1"],
      startupConfig: "hostname R1",
    });
    expect(result.links).toEqual([
      {
        sourceNodeId: "1",
        sourceInterface: "Gi0/0",
        targetNodeId: "2",
        targetInterface: "Gi0/0",
        networkName: "net1",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/importers/eveUnlParser.test.ts
```

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement XML parser**

Create `apps/api/src/importers/eveUnlParser.ts`.

Implementation requirements:

- Use `XMLParser` from `fast-xml-parser` with `ignoreAttributes: false`, `attributeNamePrefix: ""`, and `textNodeName: "#text"`.
- Normalize single objects and arrays with:

```ts
function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
```

- Node fields:
  - `foreignId`: XML `id`
  - `name`: XML `name`, fallback `node-<id>`
  - `templateName`: XML `template`, fallback XML `type`
  - `imageName`: XML `image`, fallback `qemu_image`, fallback `null`
  - `runtimeHint`: `cloud` for network/cloud types, `container` for docker types, otherwise `qemu`
  - `position`: `left/top` numeric values, fallback grid positions
  - `ramMb`: numeric `ram` if present
  - `interfaceNames`: explicit `<interface name="">` values, or generated `eth0..ethN` from `ethernet`
  - `startupConfig`: first config text found under `configs/config`
- Link construction:
  - Group interfaces by nonzero `network_id`.
  - If exactly two interfaces share a network, emit one point-to-point link.
  - If more than two share a network, emit links from each node to a generated cloud node in a later task, or for MVP emit one issue warning and skip that multi-access network.
- Issues:
  - Add warnings for ignored package files, unsupported serial links, missing node IDs, or multi-access EVE networks.

- [ ] **Step 4: Run parser tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/importers/eveUnlParser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/importers/eveUnlParser.ts apps/api/src/importers/eveUnlParser.test.ts apps/api/src/importers/types.ts
git commit -m "feat: parse eve and pnetlab lab files"
```

## Task 4: GNS3 Parser

**Files:**

- Create: `apps/api/src/importers/gns3Parser.ts`
- Test: `apps/api/src/importers/gns3Parser.test.ts`

- [ ] **Step 1: Write failing GNS3 parser tests**

Create `apps/api/src/importers/gns3Parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseGns3Topology } from "./gns3Parser.js";

describe("parseGns3Topology", () => {
  it("normalizes nodes and links", () => {
    const result = parseGns3Topology({
      format: "gns3",
      originalFileName: "demo.gns3",
      topologyPath: "demo.gns3",
      ignoredFiles: [],
      content: JSON.stringify({
        name: "GNS3 Demo",
        topology: {
          nodes: [
            {
              node_id: "n1",
              name: "R1",
              node_type: "qemu",
              template_id: "iosv",
              x: 10,
              y: 20,
              properties: { hda_disk_image: "iosv.qcow2", ram: 1024 },
              ports: [{ adapter_number: 0, port_number: 0, name: "Gi0/0" }],
            },
            {
              node_id: "n2",
              name: "R2",
              node_type: "qemu",
              template_id: "iosv",
              x: 200,
              y: 20,
              properties: { hda_disk_image: "iosv.qcow2" },
              ports: [{ adapter_number: 0, port_number: 0, name: "Gi0/0" }],
            },
          ],
          links: [
            {
              nodes: [
                { node_id: "n1", adapter_number: 0, port_number: 0 },
                { node_id: "n2", adapter_number: 0, port_number: 0 },
              ],
            },
          ],
        },
      }),
    });

    expect(result.name).toBe("GNS3 Demo");
    expect(result.nodes[0]).toMatchObject({
      foreignId: "n1",
      name: "R1",
      templateName: "iosv",
      imageName: "iosv.qcow2",
      position: { x: 10, y: 20 },
      interfaceNames: ["Gi0/0"],
    });
    expect(result.links).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/importers/gns3Parser.test.ts
```

Expected: FAIL because the parser does not exist.

- [ ] **Step 3: Implement parser**

Create `apps/api/src/importers/gns3Parser.ts`.

Implementation requirements:

- Parse JSON and validate that `topology.nodes` is an array.
- Node fields:
  - `foreignId`: `node_id`
  - `name`: `name`
  - `templateName`: `template_id`, `template_name`, or `node_type`
  - `imageName`: `properties.hda_disk_image`, `properties.qcow2`, `properties.image`, or `null`
  - `runtimeHint`: `container` for docker nodes, `cloud` for cloud/ethernet switch if no image, otherwise `qemu`
  - `position`: `x/y`, fallback grid
  - `ramMb`: `properties.ram`
  - `interfaceNames`: from `ports[].name`, fallback `adapter/port` labels.
- Link endpoint resolution:
  - Match link endpoints by `node_id`, `adapter_number`, and `port_number`.
  - Use the port name if available.
  - Skip links with fewer than two endpoints and warn.

- [ ] **Step 4: Run parser tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/importers/gns3Parser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/importers/gns3Parser.ts apps/api/src/importers/gns3Parser.test.ts
git commit -m "feat: parse gns3 lab files"
```

## Task 5: Device and Image Matching

**Files:**

- Create: `apps/api/src/importers/deviceMatcher.ts`
- Create: `apps/api/src/importers/normalize.ts`
- Test: `apps/api/src/importers/deviceMatcher.test.ts`

- [ ] **Step 1: Write failing matching tests**

Create `apps/api/src/importers/deviceMatcher.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ImageRecord, Template } from "@networkchum/shared";

import { buildImportPreview } from "./deviceMatcher.js";
import type { NormalizedImportedTopology } from "./types.js";

const templates: Template[] = [
  {
    id: "cisco-iosv",
    runtime: "qemu",
    displayName: "Cisco IOSv",
    vendor: "Cisco",
    deviceRoleIcon: "router",
    boot: { console: "serial", acceleration: "hardware" },
    configSchema: {
      ramMb: { default: 512, min: 256, max: 2048 },
      vcpu: { default: 1, min: 1, max: 2 },
      interfaceCount: { default: 4, min: 1, max: 16 },
    },
  },
  {
    id: "arista-veos",
    runtime: "qemu",
    displayName: "Arista vEOS",
    vendor: "Arista",
    deviceRoleIcon: "switch",
    boot: { console: "serial", acceleration: "hardware" },
    configSchema: {
      ramMb: { default: 4096, min: 1024, max: 8192 },
      vcpu: { default: 1, min: 1, max: 4 },
      interfaceCount: { default: 4, min: 1, max: 16 },
    },
  },
];

const images: ImageRecord[] = [
  {
    id: "img-iosv",
    name: "vios-adventerprisek9.qcow2",
    path: "/images/vios.qcow2",
    format: "qcow2",
    sizeBytes: 1,
    updatedAt: "2026-04-24T00:00:00.000Z",
    templateId: "cisco-iosv",
    source: "scan",
    catalogState: "active",
  },
];

const topology: NormalizedImportedTopology = {
  source: { format: "eve-unl", fileName: "demo.unl", topologyPath: "demo.unl" },
  name: "demo",
  issues: [],
  links: [],
  nodes: [
    {
      foreignId: "1",
      name: "R1",
      templateName: "vios",
      imageName: "vios-adventerprisek9",
      runtimeHint: "qemu",
      position: { x: 10, y: 10 },
      interfaceNames: ["Gi0/0"],
    },
    {
      foreignId: "2",
      name: "SW1",
      templateName: "mystery-switch",
      imageName: "mystery.qcow2",
      runtimeHint: "qemu",
      position: { x: 100, y: 10 },
      interfaceNames: ["eth0"],
    },
  ],
};

describe("buildImportPreview", () => {
  it("matches known devices and reports substitute candidates for unknowns", () => {
    const preview = buildImportPreview({
      draftId: "draft-1",
      topology,
      templates,
      images,
    });

    expect(preview.nodes[0]).toMatchObject({
      status: "matched",
      matchedTemplateId: "cisco-iosv",
      matchedImageId: "img-iosv",
    });
    expect(preview.nodes[1]).toMatchObject({ status: "unresolved" });
    expect(
      preview.nodes[1]?.candidates.map((candidate) => candidate.templateId),
    ).toContain("arista-veos");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/importers/deviceMatcher.test.ts
```

Expected: FAIL because matcher files do not exist.

- [ ] **Step 3: Implement matching helpers**

Create `apps/api/src/importers/normalize.ts`:

```ts
export function normalizeKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\.(qcow2|img|bin|vmdk)$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function importedTemplateKey(input: {
  runtimeHint: string | null;
  templateName: string | null;
  imageName: string | null;
}): string {
  return [
    input.runtimeHint ?? "unknown",
    normalizeKey(input.templateName) || "unknown-template",
    normalizeKey(input.imageName) || "unknown-image",
  ].join(":");
}
```

Create `apps/api/src/importers/deviceMatcher.ts`.

Implementation requirements:

- Exact match priority:
  1. image filename/name normalized equals imported image normalized and image has active template binding.
  2. template display name/id/vendor normalized equals imported template normalized.
  3. synonym map for common imported names:
     - `vios`, `iosv`, `cisco-vios` -> `cisco-iosv`
     - `csr1000v`, `asr1000`, `cisco-asr` -> `cisco-asr`
     - `veos`, `arista-veos` -> `arista-veos`
     - `vsrx`, `juniper-vsrx` -> `juniper-vsrx`
     - `nxosv`, `nx-osv` -> `cisco-nxosv`
  4. fallback candidates by runtime and fuzzy-ish normalized substring.
- `buildImportPreview` groups nodes by `templateKey`, but still returns each node row.
- If any node in a group is unresolved, all same-key nodes should use the same mapping in commit.

- [ ] **Step 4: Run matching tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/importers/deviceMatcher.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/importers/normalize.ts apps/api/src/importers/deviceMatcher.ts apps/api/src/importers/deviceMatcher.test.ts
git commit -m "feat: match imported devices to local catalog"
```

## Task 6: Draft Store and Commit Conversion

**Files:**

- Create: `apps/api/src/importers/importDraftStore.ts`
- Create: `apps/api/src/importers/commitImport.ts`
- Modify: `apps/api/src/labs/labStore.ts`
- Test: `apps/api/src/importers/commitImport.test.ts`

- [ ] **Step 1: Write failing commit tests**

Create `apps/api/src/importers/commitImport.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Template } from "@networkchum/shared";

import { buildLabDocumentFromImport } from "./commitImport.js";
import type { NormalizedImportedTopology } from "./types.js";

const template: Template = {
  id: "cisco-iosv",
  runtime: "qemu",
  displayName: "Cisco IOSv",
  vendor: "Cisco",
  deviceRoleIcon: "router",
  boot: { console: "serial", acceleration: "hardware", nicModel: "e1000" },
  configSchema: {
    ramMb: { default: 512, min: 256, max: 2048 },
    vcpu: { default: 1, min: 1, max: 2 },
    interfaceCount: { default: 4, min: 1, max: 16 },
  },
};

const topology: NormalizedImportedTopology = {
  source: { format: "eve-unl", fileName: "demo.unl", topologyPath: "demo.unl" },
  name: "demo",
  issues: [],
  nodes: [
    {
      foreignId: "1",
      name: "R1",
      templateName: "vios",
      imageName: "vios",
      runtimeHint: "qemu",
      position: { x: 10, y: 20 },
      interfaceNames: ["Gi0/0"],
      startupConfig: "hostname R1",
    },
    {
      foreignId: "2",
      name: "R2",
      templateName: "vios",
      imageName: "vios",
      runtimeHint: "qemu",
      position: { x: 200, y: 20 },
      interfaceNames: ["Gi0/0"],
    },
  ],
  links: [
    {
      sourceNodeId: "1",
      sourceInterface: "Gi0/0",
      targetNodeId: "2",
      targetInterface: "Gi0/0",
      networkName: "net1",
    },
  ],
};

describe("buildLabDocumentFromImport", () => {
  it("creates a valid lab document with nodes, network, attachment, and config set", () => {
    const document = buildLabDocumentFromImport({
      labId: "lab-import",
      labName: "Imported",
      topology,
      resolvedMappings: new Map([
        ["qemu:vios:vios", { template, imageId: "img-vios" }],
      ]),
    });

    expect(document.nodes).toHaveLength(2);
    expect(document.nodes[0]).toMatchObject({
      name: "R1",
      templateId: "cisco-iosv",
      imageId: "img-vios",
      config: { interfaceCount: 1, ramMb: 512 },
    });
    expect(document.networks).toHaveLength(1);
    expect(document.attachments).toHaveLength(2);
    expect(document.startupConfigSets[0]?.nodeConfigs[0]?.config).toBe(
      "hostname R1",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/importers/commitImport.test.ts
```

Expected: FAIL because commit conversion does not exist.

- [ ] **Step 3: Add draft store**

Create `apps/api/src/importers/importDraftStore.ts`.

Implementation requirements:

- Store records in `getDataFile("import-drafts.json")`.
- Record shape:

```ts
type ImportDraftRecord = {
  id: string;
  createdAt: string;
  topology: NormalizedImportedTopology;
};
```

- Functions:
  - `createImportDraft(topology): Promise<ImportDraftRecord>`
  - `getImportDraft(draftId): Promise<ImportDraftRecord | null>`
  - `deleteImportDraft(draftId): Promise<void>`
  - `pruneImportDrafts(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void>`
- Use atomic temp-file write like `labStore.ts`.

- [ ] **Step 4: Add lab creation helper**

Modify `apps/api/src/labs/labStore.ts` with:

```ts
export async function createLabFromDocument(
  name: string,
  document: LabDocument,
): Promise<LabRecord> {
  const labs = await listLabs();
  const id = document.id;
  const now = new Date().toISOString();
  const lab: LabRecord = {
    id,
    name,
    updatedAt: now,
    autoBackup: false,
    document: { ...document, id, name },
  };

  labs.push(lab);
  await saveLabs(labs);
  return lab;
}
```

- [ ] **Step 5: Implement commit conversion**

Create `apps/api/src/importers/commitImport.ts`.

Implementation requirements:

- Generate stable new IDs:
  - node IDs: `node-import-<foreignId>-<random>`
  - interface IDs: `if-<nodeId>-<slot>`
  - network IDs: `net-import-<index>-<random>`
- Use the selected template config defaults, but clamp imported interface count to template min/max.
- If imported RAM/vCPU exist, only use them if within template limits. Otherwise use defaults and add an issue in the route preview, not in the document.
- Build startup config set if any node has `startupConfig`:
  - `id`: `cfg-imported-default`
  - `name`: `Imported startup configs`
  - map foreign node IDs to generated NetworkChum node IDs.
- Build one NetworkChum network per normalized link.
- Attach each endpoint interface to that network.
- Validate with `LabDocumentSchema.parse(document)` before returning.

- [ ] **Step 6: Run commit tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/importers/commitImport.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/importers/importDraftStore.ts apps/api/src/importers/commitImport.ts apps/api/src/importers/commitImport.test.ts apps/api/src/labs/labStore.ts
git commit -m "feat: commit imported topologies as labs"
```

## Task 7: Import API Routes

**Files:**

- Create: `apps/api/src/routes/imports.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write failing route tests**

Add to `apps/api/src/app.test.ts`:

```ts
it("previews an uploaded EVE lab import", async () => {
  const app = await buildAppForTest();
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
  expect(response.json().preview.labName).toBe("Demo");
});
```

Add a second route test for commit:

```ts
it("commits a resolved import draft as a lab", async () => {
  const app = await buildAppForTest();
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
  const draftId = previewResponse.json().preview.draftId;

  const commitResponse = await app.inject({
    method: "POST",
    url: `/imports/topology/${draftId}/commit`,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ name: "Imported Demo", mappings: [] }),
  });

  expect(commitResponse.statusCode).toBe(201);
  expect(commitResponse.json().lab.name).toBe("Imported Demo");
});
```

- [ ] **Step 2: Run the route tests to verify they fail**

Run:

```bash
npm run test --workspace @networkchum/api -- src/app.test.ts -t "import"
```

Expected: FAIL because routes are not registered.

- [ ] **Step 3: Implement routes**

Create `apps/api/src/routes/imports.ts`.

Implementation requirements:

- `POST /imports/topology/preview`
  - Read one multipart part named `file`.
  - Limit accepted upload to reasonable topology package size, for example 50 MB.
  - Call `readTopologyUpload`.
  - Dispatch to `parseEveUnlTopology` for `eve-unl` / `pnetlab-unl`.
  - Dispatch to `parseGns3Topology` for `gns3` / `gns3-project`.
  - Create draft with `createImportDraft`.
  - Load templates with `new TemplateRegistry().list()`.
  - Load images with `listImages()`.
  - Return `{ preview }`.
- `POST /imports/topology/:draftId/commit`
  - Parse `ImportCommitRequestSchema`.
  - Load draft or return 404.
  - Load registry and images.
  - Build resolved mappings:
    - Auto use matched preview mappings.
    - Overlay user-provided substitutions.
    - Verify every `templateKey` used by draft nodes resolves to a template.
    - Verify `imageId`, if provided, exists and is active.
  - Call `buildLabDocumentFromImport`.
  - Call `createLabFromDocument`.
  - Delete draft.
  - Return `201 { lab }`.
  - Do not power on imported nodes.

Modify `apps/api/src/app.ts`:

```ts
import { importRoutes } from "./routes/imports.js";

await app.register(importRoutes);
```

- [ ] **Step 4: Run API import route tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/app.test.ts -t "import"
```

Expected: PASS.

- [ ] **Step 5: Run all API tests**

Run:

```bash
npm run test --workspace @networkchum/api
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/imports.ts apps/api/src/app.ts apps/api/src/app.test.ts
git commit -m "feat: expose topology import api"
```

## Task 8: Web API Client

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Test: `apps/web/src/api/client.test.ts`

- [ ] **Step 1: Write failing client tests**

Add tests to `apps/web/src/api/client.test.ts`:

```ts
it("uploads a topology file for import preview", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        preview: {
          draftId: "draft-1",
          source: { format: "eve-unl", fileName: "demo.unl" },
          labName: "Demo",
          summary: { nodes: 0, networks: 0, links: 0 },
          nodes: [],
          issues: [],
        },
      }),
      { status: 200 },
    ),
  );
  const client = createApiClient(fetcher);

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
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        lab: {
          id: "lab-1",
          name: "Demo",
          document: { nodes: [], networks: [], attachments: [] },
        },
      }),
      { status: 201 },
    ),
  );
  const client = createApiClient(fetcher);

  const lab = await client.commitTopologyImport("draft-1", {
    name: "Demo",
    mappings: [
      {
        templateKey: "qemu:vios:vios",
        templateId: "cisco-iosv",
        imageId: "img-1",
      },
    ],
  });

  expect(fetcher).toHaveBeenCalledWith(
    "/api/imports/topology/draft-1/commit",
    expect.objectContaining({ method: "POST" }),
  );
  expect(lab.id).toBe("lab-1");
});
```

- [ ] **Step 2: Run client tests to verify they fail**

Run:

```bash
npm run test --workspace @networkchum/web -- src/api/client.test.ts
```

Expected: FAIL because client methods do not exist.

- [ ] **Step 3: Implement client methods**

Modify `apps/web/src/api/client.ts`:

- Import `ImportCommitRequest` and `ImportPreview` from `@networkchum/shared`.
- Add `previewTopologyImport(file: File): Promise<ImportPreview>`.
- Add `commitTopologyImport(draftId: string, input: ImportCommitRequest): Promise<LabDetails>`.
- Use `FormData` with `file` for preview.
- Use JSON for commit.

- [ ] **Step 4: Run client tests**

Run:

```bash
npm run test --workspace @networkchum/web -- src/api/client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/client.test.ts
git commit -m "feat: add topology import client"
```

## Task 9: Import Dialog UI

**Files:**

- Create: `apps/web/src/components/ImportTopologyDialog.tsx`
- Create: `apps/web/src/components/ImportTopologyDialog.test.tsx`
- Modify: `apps/web/src/theme.css`

- [ ] **Step 1: Write failing dialog tests**

Create `apps/web/src/components/ImportTopologyDialog.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImportTopologyDialog } from "./ImportTopologyDialog.js";

describe("ImportTopologyDialog", () => {
  it("previews an uploaded file and requires mappings before commit", async () => {
    const onPreview = vi.fn().mockResolvedValue({
      draftId: "draft-1",
      source: { format: "eve-unl", fileName: "demo.unl" },
      labName: "Demo",
      summary: { nodes: 1, networks: 0, links: 0 },
      issues: [],
      nodes: [
        {
          foreignId: "1",
          name: "R1",
          templateKey: "qemu:mystery:mystery",
          requestedTemplate: "mystery",
          requestedImage: "mystery",
          status: "unresolved",
          candidates: [{ templateId: "cisco-iosv", label: "Cisco IOSv" }],
        },
      ],
    });
    const onCommit = vi.fn();

    render(
      <ImportTopologyDialog
        open
        catalog={[
          {
            id: "cisco-iosv",
            name: "Cisco IOSv",
            source: "built-in",
            runtime: "qemu",
          },
        ]}
        images={[
          {
            id: "img-1",
            name: "iosv.qcow2",
            templateId: "cisco-iosv",
            source: "scan",
            catalogState: "active",
          },
        ]}
        onClose={vi.fn()}
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Topology File"), {
      target: { files: [new File(["<lab />"], "demo.unl")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Import" }));

    expect(await screen.findByText("Demo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Lab" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Substitute for R1"), {
      target: { value: "cisco-iosv" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import Lab" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit.mock.calls[0][1].mappings[0]).toMatchObject({
      templateKey: "qemu:mystery:mystery",
      templateId: "cisco-iosv",
    });
  });
});
```

- [ ] **Step 2: Run dialog tests to verify they fail**

Run:

```bash
npm run test --workspace @networkchum/web -- src/components/ImportTopologyDialog.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement dialog**

Create `apps/web/src/components/ImportTopologyDialog.tsx`.

Component props:

```ts
type ImportTopologyDialogProps = {
  open: boolean;
  catalog: CatalogSummary[];
  images: ImageRecordSummary[];
  onClose: () => void;
  onPreview: (file: File) => Promise<ImportPreview>;
  onCommit: (draftId: string, input: ImportCommitRequest) => Promise<void>;
};
```

UI behavior:

- Hidden when `open` is false.
- File input accepts `.unl,.gns3,.gns3project,.gns3p,.zip`.
- Preview button disabled until file selected.
- After preview:
  - Show lab name, format, node/network/link counts.
  - Show issues as warnings.
  - Show node mapping table.
  - For matched nodes, show matched template/image.
  - For unresolved nodes, show a select labeled `Substitute for <node name>`.
  - Template select options from candidates first, then all compatible catalog entries.
  - Optional image select when selected template is qemu.
- Import button disabled while any unresolved group has no template selection.
- On commit, send one mapping per `templateKey`, not one per node.
- Do not show marketing/instructions text in the main app beyond labels needed for operation.

Style in `apps/web/src/theme.css`:

- Use existing dialog patterns.
- Mapping table should be dense and scannable.
- Avoid nested cards.

- [ ] **Step 4: Run dialog tests**

Run:

```bash
npm run test --workspace @networkchum/web -- src/components/ImportTopologyDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ImportTopologyDialog.tsx apps/web/src/components/ImportTopologyDialog.test.tsx apps/web/src/theme.css
git commit -m "feat: add topology import dialog"
```

## Task 10: Wire Import Into the App

**Files:**

- Modify: `apps/web/src/components/LabBrowser.tsx`
- Modify: `apps/web/src/components/LabBrowser.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing integration tests**

Update `apps/web/src/components/LabBrowser.test.tsx` to expect an import callback:

```tsx
it("offers lab import", () => {
  const onImportLab = vi.fn();
  render(
    <LabBrowser
      labs={[]}
      selectedLabId={null}
      onCreateLab={vi.fn()}
      onSelectLab={vi.fn()}
      onDeleteLab={vi.fn()}
      onImportLab={onImportLab}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Import Lab" }));
  expect(onImportLab).toHaveBeenCalled();
});
```

Add an app test that opens the dialog, previews, commits, and selects returned lab using a mocked API client.

- [ ] **Step 2: Run affected web tests to verify they fail**

Run:

```bash
npm run test --workspace @networkchum/web -- src/components/LabBrowser.test.tsx src/App.test.tsx
```

Expected: FAIL because import is not wired.

- [ ] **Step 3: Wire UI**

Modify `LabBrowser.tsx`:

- Add `onImportLab?: () => void`.
- Render an `Import Lab` button near `Create Lab`.

Modify `App.tsx`:

- Add `importDialogOpen` state.
- Ensure `listCatalog`, `listImages`, and templates/images are available before opening.
- Render `ImportTopologyDialog`.
- `onPreview`: `api.previewTopologyImport(file)`.
- `onCommit`:
  - call `api.commitTopologyImport(draftId, input)`
  - close dialog
  - refresh labs
  - set selected lab to returned lab
  - update `currentLab` state to returned lab

- [ ] **Step 4: Run affected web tests**

Run:

```bash
npm run test --workspace @networkchum/web -- src/components/LabBrowser.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Run full web tests**

Run:

```bash
npm run test --workspace @networkchum/web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/LabBrowser.tsx apps/web/src/components/LabBrowser.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: wire topology import into app"
```

## Task 11: README and Manual Smoke Test

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Update docs**

Add a section:

```md
## Importing Existing Labs

NetworkChum can import topology files from:

- EVE-NG / PNETLab `.unl`
- GNS3 `.gns3`
- GNS3 `.gns3project` / `.gns3p` / `.zip` packages containing one topology file

The importer reads topology, node positions, links, interface names, and best-effort startup configs. It does not import VM disk images from packages in the first version. When an imported node references a device type or image that is not available in the local catalog, NetworkChum asks you to choose a local substitute template and, where applicable, a bound image before creating the lab.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: all pass.

- [ ] **Step 3: Manual smoke test**

Run:

```bash
npm run dev
```

Manual checks:

- Open `http://localhost:5173/`.
- Click `Labs`.
- Click `Import Lab`.
- Upload a tiny `.unl`.
- Confirm preview appears.
- Pick a substitute for any unresolved node.
- Click `Import Lab`.
- Confirm the imported lab opens on the canvas with nodes and links.
- Confirm all nodes are powered off.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document topology import"
```

## Future Extension: Live Server Import

Do not implement this in the first pass. Preserve the parser boundary so future adapters can feed `NormalizedImportedTopology` from:

- EVE-NG API lab topology and node export endpoints.
- PNETLab API or filesystem scrape.
- GNS3 controller API project topology.

The live adapter should reuse the same preview and commit flow so remote import never bypasses substitution review.

## Final Verification

After all tasks:

```bash
npm test
npm run build
git diff --check
```

Expected:

- API tests pass.
- Web tests pass.
- Shared tests pass.
- TypeScript builds all workspaces.
- No whitespace errors.
