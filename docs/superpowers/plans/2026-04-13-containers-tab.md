# Containers Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Containers tab that can list local container images, search/pull remote images, and either save a reusable container template or create a one-off node in the current lab.

**Architecture:** The implementation will add a container runtime service in the API, a persisted user container template store, new container-focused API routes, and a web Containers tab plus action dialog. Reusable saved container templates will merge into the existing Devices catalog, while one-off creation will bypass reusable persistence and create a container node directly in the active lab.

**Tech Stack:** TypeScript, React, Fastify, Zod, Vitest, Vite

---

## File Map

- Create: `apps/api/src/runtime/container/containerRuntimeService.ts`
  - detect `podman`/`docker`
  - list local images
  - pull images
  - search registries through provider-specific helpers
- Create: `apps/api/src/runtime/container/containerRuntimeService.test.ts`
  - cover runtime detection, local image parsing, search, and pull
- Create: `apps/api/src/runtime/container/dockerHubRegistry.ts`
  - Docker Hub search and image-reference normalization helpers
- Create: `apps/api/src/runtime/container/userContainerTemplateStore.ts`
  - persist user-created container templates in app data
- Create: `apps/api/src/runtime/container/userContainerTemplateStore.test.ts`
  - cover persistence and reload behavior
- Modify: `apps/api/src/templates/templateRegistry.ts`
  - merge built-in templates with persisted user container templates
- Modify: `apps/api/src/templates/templateRegistry.test.ts`
  - cover merged built-in + user-defined template listing
- Create: `apps/api/src/routes/containers.ts`
  - runtime status
  - local images
  - search
  - pull
  - save template
  - create one-off node
- Modify: `apps/api/src/app.ts`
  - register container routes
- Modify: `apps/api/src/app.test.ts`
  - cover route-level container flows
- Modify: `apps/api/src/catalog/getCatalog.ts`
  - ensure saved user container templates appear in Devices
- Modify: `apps/api/src/catalog/getCatalog.test.ts`
  - cover saved container templates in catalog output
- Modify: `apps/api/src/routes/labs.ts`
  - accept one-off container node creation data if needed by chosen route shape
- Modify: `apps/api/src/topology/mutations.ts`
  - support creation of container nodes from dynamic user templates or image refs
- Modify: `apps/api/src/topology/mutations.test.ts`
  - cover dynamic container-node creation
- Modify: `packages/shared/src/catalog.ts`
  - extend shared catalog/template schema if user-defined container template metadata needs new fields
- Modify: `packages/shared/src/catalog.test.ts`
  - cover schema additions
- Modify: `apps/web/src/api/client.ts`
  - add container endpoints and types
- Create: `apps/web/src/components/ContainersTab.tsx`
  - render local image list, search/pull form, and action entry points
- Create: `apps/web/src/components/ContainersTab.test.tsx`
  - cover list/search/pull and empty states
- Create: `apps/web/src/components/ContainerImageActionDialog.tsx`
  - choose save-template vs one-off-node flow
- Create: `apps/web/src/components/ContainerImageActionDialog.test.tsx`
  - cover defaults and validation
- Modify: `apps/web/src/App.tsx`
  - add new tab
  - wire container APIs and dialog flows
  - refresh catalog/lab state after save/create
- Modify: `apps/web/src/App.test.tsx`
  - cover end-to-end tab flow
- Modify: `apps/web/src/components/DeviceCatalog.tsx`
  - no behavioral change expected, but verify saved container templates render cleanly if needed
- Modify: `README.md`
  - document Containers tab workflow and runtime detection
- Modify: `INSTALL.md`
  - document container-runtime requirement and detection order

## Task 1: Add Container Runtime Service

**Files:**

- Create: `apps/api/src/runtime/container/containerRuntimeService.ts`
- Create: `apps/api/src/runtime/container/dockerHubRegistry.ts`
- Test: `apps/api/src/runtime/container/containerRuntimeService.test.ts`

- [ ] **Step 1: Write the failing runtime-service tests**

Add tests for:

- runtime detection preferring `podman` when available
- fallback to `docker` when `podman` is unavailable
- listing local images from normalized CLI output
- preparing a Docker Hub search request
- pulling a direct image ref like `oraclelinux:9-slim`

- [ ] **Step 2: Run the runtime-service tests to verify they fail**

Run: `npm run test --workspace @networkchum/api -- src/runtime/container/containerRuntimeService.test.ts`

Expected: FAIL because the service does not exist yet.

- [ ] **Step 3: Implement the minimal runtime service**

Implement:

- host runtime detection
- local image listing
- direct pull
- Docker Hub default search helper

Keep parsing and registry-specific logic isolated in this service layer.

- [ ] **Step 4: Re-run the runtime-service tests**

Run: `npm run test --workspace @networkchum/api -- src/runtime/container/containerRuntimeService.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/runtime/container/containerRuntimeService.ts apps/api/src/runtime/container/dockerHubRegistry.ts apps/api/src/runtime/container/containerRuntimeService.test.ts
git commit -m "feat: add container runtime service"
```

## Task 2: Persist User Container Templates

**Files:**

- Create: `apps/api/src/runtime/container/userContainerTemplateStore.ts`
- Create: `apps/api/src/runtime/container/userContainerTemplateStore.test.ts`
- Modify: `apps/api/src/templates/templateRegistry.ts`
- Modify: `apps/api/src/templates/templateRegistry.test.ts`

- [ ] **Step 1: Write the failing template-store tests**

Add tests for:

- saving a user-defined container template
- reloading persisted templates
- merging saved templates into template registry output

- [ ] **Step 2: Run the tests to verify failure**

Run: `npm run test --workspace @networkchum/api -- src/runtime/container/userContainerTemplateStore.test.ts src/templates/templateRegistry.test.ts`

Expected: FAIL because user-defined template persistence does not exist yet.

- [ ] **Step 3: Implement the minimal persistence layer**

Persist:

- `id`
- `displayName`
- `runtime`
- `vendor`
- `imageRef`
- `registry`
- `engine`
- simple launch metadata
- default compute/interface schema

Then merge saved templates into `TemplateRegistry.list()` and `TemplateRegistry.get()` in a way that preserves current built-ins.

- [ ] **Step 4: Re-run the tests**

Run: `npm run test --workspace @networkchum/api -- src/runtime/container/userContainerTemplateStore.test.ts src/templates/templateRegistry.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/runtime/container/userContainerTemplateStore.ts apps/api/src/runtime/container/userContainerTemplateStore.test.ts apps/api/src/templates/templateRegistry.ts apps/api/src/templates/templateRegistry.test.ts
git commit -m "feat: persist user container templates"
```

## Task 3: Add Container API Routes

**Files:**

- Create: `apps/api/src/routes/containers.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write the failing route tests**

Add tests for:

- returning detected runtime
- listing local images
- searching the default registry
- pulling a new image
- saving a reusable template from a local/pulled image

- [ ] **Step 2: Run route tests to verify failure**

Run: `npm run test --workspace @networkchum/api -- src/app.test.ts`

Expected: FAIL because `/containers/*` routes are not registered.

- [ ] **Step 3: Implement the minimal routes**

Add endpoints for:

- `GET /containers/runtime`
- `GET /containers/images`
- `GET /containers/search`
- `POST /containers/pull`
- `POST /containers/templates`

Use the runtime service and template store created earlier.

- [ ] **Step 4: Re-run route tests**

Run: `npm run test --workspace @networkchum/api -- src/app.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/containers.ts apps/api/src/app.ts apps/api/src/app.test.ts
git commit -m "feat: add container management API routes"
```

## Task 4: Add One-Off Container Node Creation

**Files:**

- Modify: `apps/api/src/routes/labs.ts`
- Modify: `apps/api/src/topology/mutations.ts`
- Modify: `apps/api/src/topology/mutations.test.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write the failing one-off creation tests**

Add tests for:

- creating a one-off container node in the current lab from an image reference
- blocking the flow when no active lab/current lab id is available

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test --workspace @networkchum/api -- src/topology/mutations.test.ts src/app.test.ts`

Expected: FAIL because one-off container image creation is not supported.

- [ ] **Step 3: Implement the minimal one-off path**

Choose one route shape and implement it consistently:

- either a dedicated `POST /labs/:labId/container-nodes`
- or extend existing node creation with container-image payloads

The implementation must:

- create a container runtime node
- attach the selected image/runtime metadata required for launch
- avoid silently saving a reusable template

- [ ] **Step 4: Re-run tests**

Run: `npm run test --workspace @networkchum/api -- src/topology/mutations.test.ts src/app.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/labs.ts apps/api/src/topology/mutations.ts apps/api/src/topology/mutations.test.ts apps/api/src/app.test.ts
git commit -m "feat: add one-off container node creation"
```

## Task 5: Merge Saved Container Templates Into Devices Catalog

**Files:**

- Modify: `apps/api/src/catalog/getCatalog.ts`
- Modify: `apps/api/src/catalog/getCatalog.test.ts`
- Modify: `packages/shared/src/catalog.ts`
- Modify: `packages/shared/src/catalog.test.ts`

- [ ] **Step 1: Write the failing catalog tests**

Add tests for:

- saved user container templates appearing in the Devices catalog
- qemu entries still requiring bound images
- built-in cloud entries remaining visible

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test --workspace @networkchum/api -- src/catalog/getCatalog.test.ts && npm run test --workspace @networkchum/shared -- src/catalog.test.ts`

Expected: FAIL because saved user container templates are not merged yet.

- [ ] **Step 3: Implement minimal catalog merge behavior**

Update catalog assembly to include:

- image-bound qemu entries
- built-in cloud entries
- built-in container entries
- saved user container templates

without duplicating entries unnecessarily.

- [ ] **Step 4: Re-run tests**

Run: `npm run test --workspace @networkchum/api -- src/catalog/getCatalog.test.ts && npm run test --workspace @networkchum/shared -- src/catalog.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/catalog/getCatalog.ts apps/api/src/catalog/getCatalog.test.ts packages/shared/src/catalog.ts packages/shared/src/catalog.test.ts
git commit -m "feat: surface saved container templates in catalog"
```

## Task 6: Build the Containers Tab UI

**Files:**

- Create: `apps/web/src/components/ContainersTab.tsx`
- Create: `apps/web/src/components/ContainersTab.test.tsx`
- Create: `apps/web/src/components/ContainerImageActionDialog.tsx`
- Create: `apps/web/src/components/ContainerImageActionDialog.test.tsx`
- Modify: `apps/web/src/api/client.ts`

- [ ] **Step 1: Write the failing component tests**

Add tests for:

- rendering local images
- searching with Docker Hub as the default registry
- opening the action dialog from a local image
- opening the action dialog from a search result
- defaulting the action to `Save as reusable template`

- [ ] **Step 2: Run component tests to verify failure**

Run: `npm run test --workspace @networkchum/web -- src/components/ContainersTab.test.tsx src/components/ContainerImageActionDialog.test.tsx`

Expected: FAIL because the components and client methods do not exist.

- [ ] **Step 3: Implement the minimal web components**

Build:

- local image list
- search/pull form
- registry selector
- reusable-template vs one-off-node action dialog

Extend API client methods for the new routes.

- [ ] **Step 4: Re-run component tests**

Run: `npm run test --workspace @networkchum/web -- src/components/ContainersTab.test.tsx src/components/ContainerImageActionDialog.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ContainersTab.tsx apps/web/src/components/ContainersTab.test.tsx apps/web/src/components/ContainerImageActionDialog.tsx apps/web/src/components/ContainerImageActionDialog.test.tsx apps/web/src/api/client.ts
git commit -m "feat: add containers tab UI"
```

## Task 7: Wire the New Tab Into the App Shell

**Files:**

- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write the failing app-shell tests**

Add tests for:

- switching to the Containers tab
- saving a reusable container template and seeing it in Devices
- creating a one-off node in the current lab
- preventing one-off creation when there is no active lab

- [ ] **Step 2: Run app tests to verify failure**

Run: `npm run test --workspace @networkchum/web -- src/App.test.tsx`

Expected: FAIL because the new tab and flows are not wired in.

- [ ] **Step 3: Implement minimal app wiring**

Wire:

- tab navigation
- runtime status load
- image list load
- search/pull actions
- save-template refresh
- one-off node creation refresh

- [ ] **Step 4: Re-run app tests**

Run: `npm run test --workspace @networkchum/web -- src/App.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: wire container workflows into app shell"
```

## Task 8: Document Operator Setup And Workflow

**Files:**

- Modify: `README.md`
- Modify: `INSTALL.md`

- [ ] **Step 1: Update docs**

Document:

- container runtime auto-detection order
- Containers tab usage
- Docker Hub default behavior
- local-image vs pulled-image flows
- reusable-template vs one-off-node actions

- [ ] **Step 2: Verify docs are accurate against the implementation**

Run:

- `npm run test --workspace @networkchum/api -- src/runtime/container/containerRuntimeService.test.ts`
- `npm run test --workspace @networkchum/web -- src/components/ContainersTab.test.tsx src/App.test.tsx`

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add README.md INSTALL.md
git commit -m "docs: add containers tab workflow"
```
