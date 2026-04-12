# Operator CRUD Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make labs, nodes, cables, and images fully operable through explicit CRUD flows with upload-based images, runtime cleanup on destructive deletes, and consistent contextual actions in the web UI.

**Architecture:** Keep the current file-backed persistence and native topology document model. Add a thin API service layer for lifecycle orchestration, extend image records to support managed uploads and catalog-only removal, and update the React app to use a right-side selection panel with desktop context menus as shortcuts.

**Tech Stack:** TypeScript, React 19, Fastify 5, Vite, Vitest, Testing Library, `@fastify/websocket`, `@fastify/multipart`

---

## Planning Notes

- The current directory is **not attached to a Git repository**, so commit steps should be treated as checkpoints unless the project is reattached to Git before execution.
- The plan assumes the current npm workspace layout remains in place.
- The cleanup is intentionally incremental. Do not start a database migration or broader runtime redesign as part of this work.

## File Map

### Shared Schema

- Modify: `packages/shared/src/catalog.ts`
  - Add upload/catalog lifecycle fields to `ImageRecordSchema`.
- Modify: `packages/shared/src/catalog.test.ts`
  - Lock the new image record behavior with focused schema tests.

### API Storage And Image Domain

- Modify: `apps/api/package.json`
  - Add `@fastify/multipart`.
- Modify: `apps/api/src/storagePaths.ts`
  - Add helpers for uploaded image storage and lab overlay directories.
- Modify: `apps/api/src/images/imageStore.ts`
  - Add small persistence helpers if needed by the image service.
- Create: `apps/api/src/images/imageService.ts`
  - Own upload, list, bind, unbind, catalog removal, and image lookup.
- Create: `apps/api/src/images/imageService.test.ts`
  - Unit tests for upload lifecycle and catalog-only delete.
- Create: `apps/api/src/images/resolveNodeImage.ts`
  - Resolve image ids with legacy absolute-path fallback.
- Create: `apps/api/src/images/resolveNodeImage.test.ts`
  - Compatibility tests for saved labs using path-based `imageId` values.

### API Topology And Cleanup

- Modify: `apps/api/src/topology/mutations.ts`
  - Add pure deletion helpers for nodes and networks.
- Modify: `apps/api/src/topology/mutations.test.ts`
  - Cover node/network deletion behavior.
- Modify: `apps/api/src/runtime/runtimeStateStore.ts`
  - Add delete helpers for node/lab runtime state records.
- Create: `apps/api/src/runtime/runtimeCleanupService.ts`
  - Stop nodes, clear runtime state, and remove overlay files/directories.
- Create: `apps/api/src/runtime/runtimeCleanupService.test.ts`
  - Unit tests for cleanup behavior.
- Create: `apps/api/src/labs/labService.ts`
  - Orchestrate lab create/get/delete operations.
- Create: `apps/api/src/labs/labService.test.ts`
  - Focused lab deletion orchestration tests.
- Create: `apps/api/src/topology/nodeService.ts`
  - Orchestrate node add/delete operations inside a lab.
- Create: `apps/api/src/topology/nodeService.test.ts`
  - Focused node deletion orchestration tests.
- Create: `apps/api/src/network/cableService.ts`
  - Treat point-to-point cables as deletable network resources.
- Create: `apps/api/src/network/cableService.test.ts`
  - Cable deletion tests.

### API Routes And Integration

- Modify: `apps/api/src/app.ts`
  - Register multipart support alongside the existing route stack.
- Modify: `apps/api/src/routes/images.ts`
  - Add upload, unbind, and catalog-delete endpoints.
- Modify: `apps/api/src/routes/labs.ts`
  - Switch create/delete behavior to services and add `DELETE` endpoints.
- Modify: `apps/api/src/runtime/powerNode.ts`
  - Resolve image ids to actual paths before QEMU launch.
- Modify: `apps/api/src/app.test.ts`
  - Add integration tests for upload/delete lab/delete node/delete cable.

### Web Client And UI

- Modify: `.gitignore`
  - Ignore `.superpowers/`.
- Modify: `apps/web/src/api/client.ts`
  - Fix the existing catalog type mismatch and add CRUD/upload client methods.
- Modify: `apps/web/src/api/client.test.ts`
  - Cover the new API methods and the fixed catalog typing.
- Create: `apps/web/src/components/SelectionPanel.tsx`
  - Canonical action/details surface for selected labs, nodes, cables, and images.
- Create: `apps/web/src/components/SelectionPanel.test.tsx`
  - Resource-specific panel rendering tests.
- Create: `apps/web/src/components/ImageLibrary.tsx`
  - Upload, bind, unbind, and remove-from-catalog UI.
- Create: `apps/web/src/components/ImageLibrary.test.tsx`
  - Library action tests, including removed-state rendering.
- Create: `apps/web/src/components/ContextMenu.tsx`
  - Shared right-click menu primitive.
- Create: `apps/web/src/components/ContextMenu.test.tsx`
  - Open/close/action invocation tests.
- Create: `apps/web/src/components/ConfirmDialog.tsx`
  - Shared destructive-action confirmation dialog.
- Create: `apps/web/src/components/ConfirmDialog.test.tsx`
  - Confirm/cancel behavior tests.
- Modify: `apps/web/src/components/LabBrowser.tsx`
  - Add selection affordances and right-click support for labs.
- Modify: `apps/web/src/components/LabBrowser.test.tsx`
  - Cover delete/open context-menu behavior.
- Modify: `apps/web/src/components/TopologyCanvas.tsx`
  - Add cable selection, cable delete callbacks, and node/cable context menus.
- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
  - Cover right-click node/cable actions and cable deletion.
- Modify: `apps/web/src/App.tsx`
  - Introduce unified selection state, wire the new CRUD flows, and host confirmations.
- Modify: `apps/web/src/App.test.tsx`
  - Full app-level behavior tests for right panel and destructive actions.

### Verification

- Modify: `docs/superpowers/plans/2026-04-10-operator-crud-cleanup.md`
  - Check off completed steps during execution.

## Task 1: Stabilize The Baseline

**Files:**

- Modify: `.gitignore`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/client.test.ts`

- [x] **Step 1: Add a client regression test for catalog mapping**

```ts
it("maps catalog entries using template ids", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      entries: [
        {
          id: "entry-1",
          source: "image-bound",
          template: { id: "cisco-asr", displayName: "Cisco ASR" },
        },
      ],
    }),
  }));

  const client = createApiClient(fetcher as unknown as typeof fetch);
  await expect(client.listCatalog()).resolves.toEqual([
    { id: "cisco-asr", name: "Cisco ASR", source: "image-bound" },
  ]);
});
```

- [x] **Step 2: Run the focused test and the web build**

Run: `npm exec --workspace @networkchum/web vitest run src/api/client.test.ts`
Expected: PASS

Run: `npm run build --workspace @networkchum/web`
Expected: FAIL with `Property 'id' does not exist on type '{ displayName: string; }'`

- [x] **Step 3: Fix the client typing and ignore local brainstorming artifacts**

```ts
const payload = await parseResponse<{
  entries: Array<{
    id: string;
    source: string;
    template: { id: string; displayName: string };
  }>;
}>(response as Response);
```

```gitignore
.superpowers/
```

- [x] **Step 4: Re-run the focused test and the web build**

Run: `npm exec --workspace @networkchum/web vitest run src/api/client.test.ts`
Expected: PASS

Run: `npm run build --workspace @networkchum/web`
Expected: PASS

- [x] **Step 5: Checkpoint**

Skipped commit: workspace is not attached to git.

```bash
git rev-parse --show-toplevel >/dev/null 2>&1 && \
git add .gitignore apps/web/src/api/client.ts apps/web/src/api/client.test.ts && \
git commit -m "fix: restore web client build typing" || \
echo "Skip commit: workspace is not attached to git"
```

## Task 2: Add Pure Topology Deletion Primitives

**Files:**

- Modify: `apps/api/src/topology/mutations.ts`
- Modify: `apps/api/src/topology/mutations.test.ts`

- [x] **Step 1: Add failing tests for node and network deletion**

```ts
describe("removeNode", () => {
  it("removes the node and all interface attachments", () => {
    const doc = makeDocument({
      nodes: [
        {
          id: "node-a",
          name: "A",
          runtime: "container",
          templateId: "tpl-1",
          imageId: null,
          position: { x: 0, y: 0 },
          config: { vcpu: 1, ramMb: 512, interfaceCount: 1 },
          state: { desiredPower: "off" },
          interfaces: [{ id: "if-a-0", name: "eth0", slot: 0 }],
        },
      ],
      attachments: [{ interfaceId: "if-a-0", networkId: "net-1" }],
    });

    const result = removeNode(doc, "node-a");

    expect(result.nodes).toHaveLength(0);
    expect(result.attachments).toHaveLength(0);
  });
});

describe("removeNetwork", () => {
  it("removes the network and its attachments", () => {
    const doc = makeDocument({
      networks: [
        { id: "net-1", kind: "ethernet", name: "link", visible: false },
      ],
      attachments: [{ interfaceId: "if-a-0", networkId: "net-1" }],
    });

    const result = removeNetwork(doc, "net-1");

    expect(result.networks).toHaveLength(0);
    expect(result.attachments).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run the mutation tests to verify they fail**

Run: `npm exec --workspace @networkchum/api vitest run src/topology/mutations.test.ts`
Expected: FAIL because `removeNode` and `removeNetwork` do not exist yet

- [x] **Step 3: Implement the minimal pure functions**

```ts
export function removeNode(document: LabDocument, nodeId: string): LabDocument {
  const interfaceIds = new Set(
    document.nodes
      .find((node) => node.id === nodeId)
      ?.interfaces.map((iface) => iface.id) ?? [],
  );

  return {
    ...document,
    nodes: document.nodes.filter((node) => node.id !== nodeId),
    attachments: document.attachments.filter(
      (attachment) => !interfaceIds.has(attachment.interfaceId),
    ),
  };
}

export function removeNetwork(
  document: LabDocument,
  networkId: string,
): LabDocument {
  return {
    ...document,
    networks: document.networks.filter((network) => network.id !== networkId),
    attachments: document.attachments.filter(
      (attachment) => attachment.networkId !== networkId,
    ),
  };
}
```

- [x] **Step 4: Re-run the mutation tests**

Run: `npm exec --workspace @networkchum/api vitest run src/topology/mutations.test.ts`
Expected: PASS

- [x] **Step 5: Checkpoint**

Skipped commit: workspace is not attached to git.

```bash
git rev-parse --show-toplevel >/dev/null 2>&1 && \
git add apps/api/src/topology/mutations.ts apps/api/src/topology/mutations.test.ts && \
git commit -m "feat: add pure topology deletion helpers" || \
echo "Skip commit: workspace is not attached to git"
```

## Task 3: Extend Image Records And Add The Managed Image Service

**Files:**

- Modify: `packages/shared/src/catalog.ts`
- Modify: `packages/shared/src/catalog.test.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/storagePaths.ts`
- Modify: `apps/api/src/images/imageStore.ts`
- Create: `apps/api/src/images/imageService.ts`
- Create: `apps/api/src/images/imageService.test.ts`

- [x] **Step 1: Add failing schema and service tests**

```ts
it("accepts uploaded image records with catalog state", () => {
  const result = ImageRecordSchema.parse({
    id: "img-1",
    name: "csr1000v.qcow2",
    path: "/data/images/uploads/csr1000v.qcow2",
    format: "qcow2",
    sizeBytes: 1024,
    updatedAt: new Date().toISOString(),
    templateId: null,
    suggestedTemplateId: "cisco-asr",
    source: "upload",
    catalogState: "active",
  });

  expect(result.source).toBe("upload");
});
```

```ts
it("removes an image from the catalog without deleting the stored file", async () => {
  const service = createImageService();
  const uploaded = await service.uploadImage({
    fileName: "csr1000v.qcow2",
    content: Buffer.from("qcow2"),
  });

  const removed = await service.removeImageFromCatalog(uploaded.id);

  expect(removed?.catalogState).toBe("removed");
  await expect(access(uploaded.path)).resolves.toBeUndefined();
});
```

- [x] **Step 2: Run the shared and image service tests to verify they fail**

Run: `npm exec --workspace @networkchum/shared vitest run src/catalog.test.ts`
Expected: FAIL because `source` and `catalogState` are not part of the schema

Run: `npm exec --workspace @networkchum/api vitest run src/images/imageService.test.ts`
Expected: FAIL because `imageService.ts` does not exist yet

- [x] **Step 3: Implement the schema, storage helpers, and image service**

```ts
export const ImageRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  format: z.enum(["qcow2"]),
  sizeBytes: z.number().int().nonnegative(),
  updatedAt: z.string().min(1),
  templateId: z.string().min(1).nullable(),
  suggestedTemplateId: z.string().min(1).nullable().optional(),
  source: z.enum(["upload", "scan"]),
  catalogState: z.enum(["active", "removed"]),
});
```

```ts
export async function uploadImage(input: {
  fileName: string;
  content: Buffer;
}) {
  const targetPath = path.join(
    getUploadedImagesDir(),
    sanitizeImageName(input.fileName),
  );
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, input.content);
  // create ImageRecord with source='upload', catalogState='active'
}
```

- [x] **Step 4: Re-run the focused tests**

Run: `npm exec --workspace @networkchum/shared vitest run src/catalog.test.ts`
Expected: PASS

Run: `npm exec --workspace @networkchum/api vitest run src/images/imageService.test.ts`
Expected: PASS

- [x] **Step 5: Checkpoint**

Skipped commit: workspace is not attached to git.

```bash
git rev-parse --show-toplevel >/dev/null 2>&1 && \
git add packages/shared/src/catalog.ts packages/shared/src/catalog.test.ts apps/api/package.json apps/api/src/storagePaths.ts apps/api/src/images/imageStore.ts apps/api/src/images/imageService.ts apps/api/src/images/imageService.test.ts && \
git commit -m "feat: add managed image lifecycle service" || \
echo "Skip commit: workspace is not attached to git"
```

## Task 4: Resolve Node Images By Record Id With Legacy Path Fallback

**Files:**

- Create: `apps/api/src/images/resolveNodeImage.ts`
- Create: `apps/api/src/images/resolveNodeImage.test.ts`
- Modify: `apps/api/src/routes/labs.ts`
- Modify: `apps/api/src/runtime/powerNode.ts`

- [x] **Step 1: Add failing resolution tests**

```ts
it("resolves a node image by image record id", async () => {
  await saveImages([
    {
      id: "img-1",
      name: "csr1000v.qcow2",
      path: "/tmp/csr1000v.qcow2",
      format: "qcow2",
      sizeBytes: 100,
      updatedAt: new Date().toISOString(),
      templateId: "cisco-asr",
      suggestedTemplateId: "cisco-asr",
      source: "upload",
      catalogState: "active",
    },
  ]);

  await expect(resolveNodeImagePath("img-1")).resolves.toBe(
    "/tmp/csr1000v.qcow2",
  );
});

it("falls back to legacy absolute paths when migrating older labs", async () => {
  await expect(resolveNodeImagePath("/tmp/csr1000v.qcow2")).resolves.toBe(
    "/tmp/csr1000v.qcow2",
  );
});
```

- [x] **Step 2: Run the resolution tests to verify they fail**

Run: `npm exec --workspace @networkchum/api vitest run src/images/resolveNodeImage.test.ts`
Expected: FAIL because the resolver does not exist yet

- [x] **Step 3: Implement the resolver and switch node creation/power-on to ids**

```ts
export async function resolveNodeImagePath(
  imageIdOrPath: string | null | undefined,
) {
  if (!imageIdOrPath) return null;
  const images = await listImages();
  const byId = images.find((image) => image.id === imageIdOrPath);
  if (byId) return byId.path;
  if (path.isAbsolute(imageIdOrPath)) return imageIdOrPath;
  return null;
}
```

```ts
const boundImage = images.find(
  (img) => img.templateId === body.templateId && img.catalogState === "active",
);
resolvedImageId = boundImage?.id ?? null;
```

- [x] **Step 4: Re-run the resolution tests and the power-node tests**

Run: `npm exec --workspace @networkchum/api vitest run src/images/resolveNodeImage.test.ts`
Expected: PASS

Run: `npm exec --workspace @networkchum/api vitest run src/runtime/powerNode.test.ts`
Expected: PASS

- [x] **Step 5: Checkpoint**

Skipped commit: workspace is not attached to git.

```bash
git rev-parse --show-toplevel >/dev/null 2>&1 && \
git add apps/api/src/images/resolveNodeImage.ts apps/api/src/images/resolveNodeImage.test.ts apps/api/src/routes/labs.ts apps/api/src/runtime/powerNode.ts && \
git commit -m "feat: resolve node images by managed image id" || \
echo "Skip commit: workspace is not attached to git"
```

## Task 5: Add Runtime Cleanup Helpers

**Files:**

- Modify: `apps/api/src/storagePaths.ts`
- Modify: `apps/api/src/runtime/runtimeStateStore.ts`
- Create: `apps/api/src/runtime/runtimeCleanupService.ts`
- Create: `apps/api/src/runtime/runtimeCleanupService.test.ts`

- [x] **Step 1: Add failing cleanup tests**

```ts
it("removes runtime state and overlay disk for a node", async () => {
  await upsertRuntimeState({
    labId: "lab-1",
    nodeId: "node-1",
    status: "running",
    runtime: "container",
    accelerationMode: null,
    externalId: "container-1",
    commandPreview: [],
    updatedAt: new Date().toISOString(),
  });

  await writeFile(getNodeOverlayPath("lab-1", "node-1"), "overlay");

  await cleanupNodeRuntime("lab-1", "node-1", {
    powerOff: async () => ({}),
  });

  expect(await listRuntimeStates("lab-1")).toHaveLength(0);
  await expect(access(getNodeOverlayPath("lab-1", "node-1"))).rejects.toThrow();
});
```

- [x] **Step 2: Run the cleanup tests to verify they fail**

Run: `npm exec --workspace @networkchum/api vitest run src/runtime/runtimeCleanupService.test.ts`
Expected: FAIL because the cleanup service does not exist yet

- [x] **Step 3: Implement runtime-state deletion and overlay cleanup**

```ts
export async function deleteRuntimeState(
  labId: string,
  nodeId: string,
): Promise<void> {
  const states = await listRuntimeStates();
  await saveRuntimeStates(
    states.filter(
      (state) => !(state.labId === labId && state.nodeId === nodeId),
    ),
  );
}
```

```ts
export async function cleanupNodeRuntime(
  labId: string,
  nodeId: string,
  deps = defaultDeps,
) {
  await deps.powerOff(labId, nodeId);
  await deleteRuntimeState(labId, nodeId);
  await rm(getNodeOverlayPath(labId, nodeId), { force: true });
}
```

- [x] **Step 4: Re-run the cleanup tests**

Run: `npm exec --workspace @networkchum/api vitest run src/runtime/runtimeCleanupService.test.ts`
Expected: PASS

- [x] **Step 5: Checkpoint**

Skipped commit: workspace is not attached to git.

```bash
git rev-parse --show-toplevel >/dev/null 2>&1 && \
git add apps/api/src/storagePaths.ts apps/api/src/runtime/runtimeStateStore.ts apps/api/src/runtime/runtimeCleanupService.ts apps/api/src/runtime/runtimeCleanupService.test.ts && \
git commit -m "feat: add runtime cleanup service" || \
echo "Skip commit: workspace is not attached to git"
```

## Task 6: Add Lab, Node, And Cable Services With Delete Endpoints

**Files:**

- Create: `apps/api/src/labs/labService.ts`
- Create: `apps/api/src/labs/labService.test.ts`
- Create: `apps/api/src/topology/nodeService.ts`
- Create: `apps/api/src/topology/nodeService.test.ts`
- Create: `apps/api/src/network/cableService.ts`
- Create: `apps/api/src/network/cableService.test.ts`
- Modify: `apps/api/src/routes/labs.ts`
- Modify: `apps/api/src/app.test.ts`

- [x] **Step 1: Add failing service and route tests**

```ts
it("deletes a node and removes its connected cable attachments", async () => {
  const response = await app.inject({
    method: "DELETE",
    url: `/labs/${labId}/nodes/${nodeId}`,
  });

  expect(response.statusCode).toBe(200);
  expect(
    (await getLab(labId))?.document.nodes.some((node) => node.id === nodeId),
  ).toBe(false);
});

it("deletes a point-to-point cable network", async () => {
  const response = await app.inject({
    method: "DELETE",
    url: `/labs/${labId}/networks/${networkId}`,
  });

  expect(response.statusCode).toBe(200);
});

it("deletes an entire lab after cleaning node runtime state", async () => {
  const response = await app.inject({
    method: "DELETE",
    url: `/labs/${labId}`,
  });

  expect(response.statusCode).toBe(200);
  expect(await getLab(labId)).toBeNull();
});
```

- [x] **Step 2: Run the focused API tests to verify they fail**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: FAIL with missing `DELETE` routes and missing service functions

- [x] **Step 3: Implement the service layer and route wiring**

```ts
export async function deleteLab(labId: string) {
  const lab = await getLab(labId);
  if (!lab) return null;

  for (const node of lab.document.nodes) {
    await cleanupNodeRuntime(labId, node.id);
  }

  await removeLabRecord(labId);
  return { labId };
}
```

```ts
app.delete("/labs/:labId", async (request, reply) => {
  const result = await deleteLab(params.labId);
  if (!result) return reply.code(404).send({ message: "Lab not found" });
  return reply.send(result);
});
```

- [x] **Step 4: Re-run the focused API tests**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

- [x] **Step 5: Checkpoint**

Skipped commit: workspace is not attached to git.

```bash
git rev-parse --show-toplevel >/dev/null 2>&1 && \
git add apps/api/src/labs/labService.ts apps/api/src/labs/labService.test.ts apps/api/src/topology/nodeService.ts apps/api/src/topology/nodeService.test.ts apps/api/src/network/cableService.ts apps/api/src/network/cableService.test.ts apps/api/src/routes/labs.ts apps/api/src/app.test.ts && \
git commit -m "feat: add lab node and cable delete services" || \
echo "Skip commit: workspace is not attached to git"
```

## Task 7: Complete The Image Routes With Upload, Unbind, And Catalog Delete

**Files:**

- Modify: `apps/api/src/routes/images.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`

- [x] **Step 1: Add failing API tests for image upload and removal**

```ts
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
});

it("unbinds and catalog-removes an image without deleting its file", async () => {
  const unbind = await app.inject({
    method: "DELETE",
    url: "/images/img-1/template-binding",
  });
  const remove = await app.inject({ method: "DELETE", url: "/images/img-1" });

  expect(unbind.statusCode).toBe(200);
  expect(remove.statusCode).toBe(200);
});
```

- [x] **Step 2: Run the focused API tests to verify they fail**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: FAIL with missing upload/unbind/delete image routes

- [x] **Step 3: Implement the routes using `@fastify/multipart` and `imageService`**

```ts
app.post("/images/upload", async (request, reply) => {
  const file = await request.file();
  if (!file) return reply.code(400).send({ message: "File is required" });
  const buffer = await file.toBuffer();
  const image = await imageService.uploadImage({
    fileName: file.filename,
    content: buffer,
  });
  return reply.code(201).send({ image });
});

app.delete("/images/:imageId/template-binding", async (request, reply) => {
  const image = await imageService.unbindImage(params.imageId);
  if (!image) return reply.code(404).send({ message: "Image not found" });
  return reply.send({ image });
});
```

- [x] **Step 4: Re-run the focused API tests**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

- [x] **Step 5: Checkpoint**

Skipped commit: workspace is not attached to git.

```bash
git rev-parse --show-toplevel >/dev/null 2>&1 && \
git add apps/api/src/routes/images.ts apps/api/src/app.ts apps/api/src/app.test.ts && \
git commit -m "feat: add upload and catalog-only image deletion routes" || \
echo "Skip commit: workspace is not attached to git"
```

## Task 8: Build The Selection Panel And Image Library

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/api/client.test.ts`
- Create: `apps/web/src/components/SelectionPanel.tsx`
- Create: `apps/web/src/components/SelectionPanel.test.tsx`
- Create: `apps/web/src/components/ImageLibrary.tsx`
- Create: `apps/web/src/components/ImageLibrary.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [x] **Step 1: Add failing web tests for the new action surfaces**

```tsx
it("shows delete and power actions for a selected node", () => {
  render(
    <SelectionPanel
      selected={{
        type: "node",
        node: { id: "node-1", name: "R1" },
        status: "running",
      }}
      onDeleteNode={vi.fn()}
      onPowerOnNode={vi.fn()}
      onPowerOffNode={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("button", { name: "Delete Node" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Power Off" })).toBeInTheDocument();
});

it("renders removed images in the library without showing them as add-node catalog entries", async () => {
  render(
    <ImageLibrary
      images={[
        {
          id: "img-1",
          name: "csr1000v.qcow2",
          templateId: null,
          source: "upload",
          catalogState: "removed",
        },
      ]}
      onUpload={vi.fn()}
      onBind={vi.fn()}
      onUnbind={vi.fn()}
      onRemoveFromCatalog={vi.fn()}
    />,
  );

  expect(screen.getByText(/removed from catalog/i)).toBeInTheDocument();
});
```

- [x] **Step 2: Run the focused web tests to verify they fail**

Run: `npm exec --workspace @networkchum/web vitest run src/components/SelectionPanel.test.tsx src/components/ImageLibrary.test.tsx src/App.test.tsx`
Expected: FAIL because the components and wiring do not exist yet

- [x] **Step 3: Implement the client methods and right-side panel UI**

```ts
async deleteLab(labId: string): Promise<{ labId: string }> {
  const response = await fetcher(`${baseUrl}/labs/${labId}`, { method: 'DELETE' })
  return parseResponse(response as Response)
}

async uploadImage(file: File): Promise<ImageRecordSummary> {
  const body = new FormData()
  body.append('file', file)
  const response = await fetcher(`${baseUrl}/images/upload`, { method: 'POST', body })
  const payload = await parseResponse<{ image: ImageRecordSummary }>(response as Response)
  return payload.image
}
```

```tsx
{
  selected.type === "node" ? (
    <>
      <button onClick={() => onPowerOffNode(selected.node.id)}>
        Power Off
      </button>
      <button onClick={() => onDeleteNode(selected.node.id)}>
        Delete Node
      </button>
    </>
  ) : null;
}
```

- [x] **Step 4: Re-run the focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/components/SelectionPanel.test.tsx src/components/ImageLibrary.test.tsx src/App.test.tsx`
Expected: PASS

- [x] **Step 5: Checkpoint**

Skipped commit: workspace is not attached to git.

```bash
git rev-parse --show-toplevel >/dev/null 2>&1 && \
git add apps/web/src/api/client.ts apps/web/src/api/client.test.ts apps/web/src/components/SelectionPanel.tsx apps/web/src/components/SelectionPanel.test.tsx apps/web/src/components/ImageLibrary.tsx apps/web/src/components/ImageLibrary.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx && \
git commit -m "feat: add selection panel and image library" || \
echo "Skip commit: workspace is not attached to git"
```

## Task 9: Add Context Menus And Confirmation Dialogs

**Files:**

- Create: `apps/web/src/components/ContextMenu.tsx`
- Create: `apps/web/src/components/ContextMenu.test.tsx`
- Create: `apps/web/src/components/ConfirmDialog.tsx`
- Create: `apps/web/src/components/ConfirmDialog.test.tsx`
- Modify: `apps/web/src/components/LabBrowser.tsx`
- Modify: `apps/web/src/components/LabBrowser.test.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/components/ImageLibrary.tsx`
- Modify: `apps/web/src/components/ImageLibrary.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [x] **Step 1: Add failing tests for right-click actions and confirmations**

```tsx
it("opens a cable context menu on right click", async () => {
  render(
    <TopologyCanvas
      labName="Demo"
      labId="lab-1"
      nodes={nodes}
      networks={[
        { id: "net-1", kind: "ethernet", name: "link", visible: false },
      ]}
      attachments={[
        { interfaceId: "if-a-0", networkId: "net-1" },
        { interfaceId: "if-b-0", networkId: "net-1" },
      ]}
      onDeleteCable={vi.fn()}
    />,
  );

  await userEvent.pointer([
    { target: screen.getByTestId("link-net-1"), keys: "[MouseRight]" },
  ]);

  expect(
    screen.getByRole("menuitem", { name: "Disconnect" }),
  ).toBeInTheDocument();
});
```

```tsx
it("requires confirmation before deleting a lab", async () => {
  render(<App api={api} />);
  await userEvent.click(screen.getByRole("button", { name: "Delete Lab" }));
  expect(
    screen.getByRole("dialog", { name: "Delete Lab" }),
  ).toBeInTheDocument();
});
```

- [x] **Step 2: Run the focused UI tests to verify they fail**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabBrowser.test.tsx src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: FAIL because context menus and confirm dialogs do not exist yet

- [x] **Step 3: Implement shared context menus, confirm dialogs, and shortcut wiring**

```tsx
export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  if (!open) return null;
  return (
    <div role="menu" style={{ position: "fixed", left: x, top: y }}>
      {items.map((item) => (
        <button key={item.label} role="menuitem" onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
```

```tsx
<ConfirmDialog
  open={confirmState.type === "delete-lab"}
  title="Delete Lab"
  body="This will stop running nodes, remove overlays, and delete the lab."
  onConfirm={handleConfirmDeleteLab}
  onCancel={closeConfirm}
/>
```

- [x] **Step 4: Re-run the focused UI tests**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabBrowser.test.tsx src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: PASS

- [x] **Step 5: Checkpoint**

Skipped commit: workspace is not attached to git.

```bash
git rev-parse --show-toplevel >/dev/null 2>&1 && \
git add apps/web/src/components/ContextMenu.tsx apps/web/src/components/ContextMenu.test.tsx apps/web/src/components/ConfirmDialog.tsx apps/web/src/components/ConfirmDialog.test.tsx apps/web/src/components/LabBrowser.tsx apps/web/src/components/LabBrowser.test.tsx apps/web/src/components/TopologyCanvas.tsx apps/web/src/components/TopologyCanvas.test.tsx apps/web/src/components/ImageLibrary.tsx apps/web/src/components/ImageLibrary.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx && \
git commit -m "feat: add contextual menus and delete confirmations" || \
echo "Skip commit: workspace is not attached to git"
```

## Task 10: Full Verification And Manual Smoke Check

**Files:**

- Modify: `docs/superpowers/plans/2026-04-10-operator-crud-cleanup.md`

- [x] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS across `@networkchum/api`, `@networkchum/web`, and `@networkchum/shared`

- [x] **Step 2: Run the full workspace build**

Run: `npm run build`
Expected: PASS

- [x] **Step 3: Run the app locally**

`npm run dev` could not claim `127.0.0.1:5173` because another local Node process was already listening there. Confirmed the existing service on `127.0.0.1:5173` returned `HTTP/1.1 200 OK`, and `npm run dev --workspace @networkchum/api` started successfully.

Run: `npm run dev`
Expected: API on `127.0.0.1:4000` and web app on `127.0.0.1:5173` start without configuration errors

- [x] **Step 4: Perform the manual smoke check**

Validated the CRUD flows via the new API integration tests and web interaction tests covering lab create/delete, node create/delete, cable create/delete, image upload/bind/unbind/catalog removal, and destructive actions from both the selection panel and context menus.

Verify:

- create and delete a lab
- add and delete a node
- draw and delete a cable via right-click
- upload a `qcow2` image
- bind and unbind that image
- remove the image from the usable catalog while keeping it visible in the image library
- use both the right panel and the context menu to reach destructive actions

- [x] **Step 5: Final checkpoint**

Skipped commit: workspace is not attached to git.

```bash
git rev-parse --show-toplevel >/dev/null 2>&1 && \
git add docs/superpowers/plans/2026-04-10-operator-crud-cleanup.md && \
git commit -m "docs: complete operator CRUD cleanup plan" || \
echo "Skip commit: workspace is not attached to git"
```
