# NetworkChum Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a single-host Linux network lab platform that boots QEMU `qcow2` images and Linux utility containers, discovers images from disk, exposes a browser topology editor and console UI, and supports live cable connect/disconnect while nodes are running.

**Architecture:** Use a monorepo with a web frontend, a backend controller API, and host runtime/network adapters. Persist labs in a JSON-native topology model with `nodes`, `networks`, and `attachments`, implement live cabling by rewiring stable host-side interfaces instead of changing guest hardware, and default VM execution to hardware-accelerated QEMU on supported hosts with `KVM` as the Linux target.

**Tech Stack:** TypeScript, React, Node.js, Fastify, SQLite, Prisma, QEMU/KVM, Docker or Podman, Linux bridge/TAP/veth networking, Vitest, Playwright

---

### Task 1: Create the repo skeleton

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `apps/web/package.json`
- Create: `apps/api/package.json`
- Create: `packages/shared/package.json`

**Step 1: Create the workspace package manifest**

```json
{
  "name": "networkchum",
  "private": true,
  "packageManager": "pnpm@10",
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm -r --parallel dev",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint"
  }
}
```

**Step 2: Create the workspace config**

```yaml
packages:
  - apps/*
  - packages/*
```

**Step 3: Add a base TypeScript config**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

**Step 4: Add minimal package files for `apps/web`, `apps/api`, and `packages/shared`**

Use placeholder `build`, `dev`, and `test` scripts so the workspace resolves cleanly.

**Step 5: Run install**

Run: `pnpm install`
Expected: workspace lockfile created with no package resolution errors

### Task 2: Establish the shared topology schema

**Files:**

- Create: `packages/shared/src/topology.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/topology.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { LabDocumentSchema } from "./topology";

describe("LabDocumentSchema", () => {
  it("accepts a minimal lab document", () => {
    const result = LabDocumentSchema.parse({
      id: "lab-1",
      name: "demo",
      version: 1,
      canvas: { zoom: 1, backgroundImage: null },
      nodes: [],
      networks: [],
      attachments: [],
      annotations: [],
      startupConfigSets: [],
    });

    expect(result.name).toBe("demo");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/shared test`
Expected: FAIL because the schema module does not exist

**Step 3: Write minimal implementation**

Define `zod` schemas for:

- `LabDocument`
- `Node`
- `NodeInterface`
- `NetworkSegment`
- `Attachment`
- `Annotation`

Include `runtime` as `qemu | container` and `desiredPower` as `on | off`.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/shared test`
Expected: PASS

### Task 3: Add template and image domain schemas

**Files:**

- Create: `packages/shared/src/catalog.ts`
- Create: `packages/shared/src/catalog.test.ts`
- Modify: `packages/shared/src/index.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { TemplateSchema } from "./catalog";

describe("TemplateSchema", () => {
  it("accepts a qemu template with resource limits", () => {
    const result = TemplateSchema.parse({
      id: "cisco-asr",
      runtime: "qemu",
      displayName: "Cisco ASR",
      configSchema: {
        ramMb: { default: 8192, min: 4096, max: 16384 },
        vcpu: { default: 4, min: 2, max: 8 },
        interfaceCount: { default: 8, min: 4, max: 24 },
      },
    });

    expect(result.runtime).toBe("qemu");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/shared test`
Expected: FAIL because `TemplateSchema` does not exist

**Step 3: Write minimal implementation**

Add schemas for:

- `ImageRecord`
- `Template`
- `CatalogEntry`
- numeric resource limits

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/shared test`
Expected: PASS

### Task 4: Bootstrap the API app

**Files:**

- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/app.test.ts`
- Modify: `apps/api/package.json`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("api", () => {
  it("returns 200 from health endpoint", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test`
Expected: FAIL because the app factory is missing

**Step 3: Write minimal implementation**

Build a Fastify app with:

- `GET /health`
- JSON response `{ ok: true }`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test`
Expected: PASS

### Task 5: Add persistence with Prisma and SQLite

**Files:**

- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/db.ts`
- Create: `apps/api/src/db.test.ts`
- Modify: `apps/api/package.json`

**Step 1: Write the failing test**

Create a test that inserts and reads a lab record with a JSON document payload.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test`
Expected: FAIL because Prisma client and schema do not exist

**Step 3: Write minimal implementation**

Add Prisma models for:

- `Lab`
- `Template`
- `Image`
- `NodeRuntimeState`

Store the canonical topology document as JSON on `Lab`.

**Step 4: Generate Prisma client and run migrations**

Run: `pnpm --filter @networkchum/api prisma generate`
Run: `pnpm --filter @networkchum/api prisma migrate dev --name init`
Expected: SQLite database and generated client created

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test`
Expected: PASS

### Task 6: Implement image scan service

**Files:**

- Create: `apps/api/src/images/scanImages.ts`
- Create: `apps/api/src/images/scanImages.test.ts`
- Create: `apps/api/src/routes/images.ts`
- Modify: `apps/api/src/app.ts`

**Step 1: Write the failing test**

Create a temp directory with a file named `csr1000v.qcow2`, run the scanner, and assert that an image record with format `qcow2` is returned.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test scanImages`
Expected: FAIL because the scanner does not exist

**Step 3: Write minimal implementation**

Implement a scanner that:

- walks one configured directory
- includes files ending in `.qcow2`
- computes size and mtime
- creates or updates image records

Expose endpoints:

- `POST /images/scan`
- `GET /images`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test scanImages`
Expected: PASS

### Task 7: Add template registry

**Files:**

- Create: `apps/api/src/templates/defaultTemplates.ts`
- Create: `apps/api/src/templates/templateRegistry.ts`
- Create: `apps/api/src/templates/templateRegistry.test.ts`
- Create: `apps/api/src/routes/templates.ts`
- Modify: `apps/api/src/app.ts`

**Step 1: Write the failing test**

Write a test that expects the registry to return templates for:

- `cisco-asr`
- `cisco-nxosv`
- `juniper-vsrx`
- `linux-generic-vm`
- `linux-alpine-container`

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test templateRegistry`
Expected: FAIL because the registry does not exist

**Step 3: Write minimal implementation**

Represent templates as JSON-backed TypeScript objects validated by the shared schema.

Start with these built-in templates:

- `linux-generic-vm`
- `cisco-asr`
- `cisco-nxosv`
- `juniper-vsrx`
- `linux-alpine-container`
- `linux-ubuntu-container`
- `linux-nettools-container`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test templateRegistry`
Expected: PASS

### Task 8: Add image-to-template binding workflow

**Files:**

- Create: `apps/api/src/images/imageBindings.ts`
- Create: `apps/api/src/images/imageBindings.test.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/routes/images.ts`

**Step 1: Write the failing test**

Write a test that:

- scans a discovered `qcow2` image
- assigns it to `cisco-asr`
- reads the binding back successfully

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test imageBindings`
Expected: FAIL because the binding service does not exist

**Step 3: Write minimal implementation**

Persist image-to-template bindings in the database. Support optional filename-based suggestions, but require explicit assignment before an unbound VM image appears as a supported catalog entry.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test imageBindings`
Expected: PASS

### Task 9: Build the catalog endpoint

**Files:**

- Create: `apps/api/src/catalog/getCatalog.ts`
- Create: `apps/api/src/catalog/getCatalog.test.ts`
- Create: `apps/api/src/routes/catalog.ts`
- Modify: `apps/api/src/app.ts`

**Step 1: Write the failing test**

Create a test that seeds one template and one image, then expects `GET /catalog` to return a combined catalog entry.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test getCatalog`
Expected: FAIL because the catalog service does not exist

**Step 3: Write minimal implementation**

Implement a catalog service that combines:

- static container templates
- VM templates matched to scanned images through explicit image bindings

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test getCatalog`
Expected: PASS

### Task 10: Create lab CRUD endpoints

**Files:**

- Create: `apps/api/src/labs/labRepository.ts`
- Create: `apps/api/src/labs/labRepository.test.ts`
- Create: `apps/api/src/routes/labs.ts`
- Modify: `apps/api/src/app.ts`

**Step 1: Write the failing test**

Write a test that creates a lab, reads it back, updates its name, and deletes it.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test labRepository`
Expected: FAIL because the repository does not exist

**Step 3: Write minimal implementation**

Add CRUD operations storing the native JSON lab document as the source of truth.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test labRepository`
Expected: PASS

### Task 11: Add topology mutation endpoints

**Files:**

- Create: `apps/api/src/topology/mutations.ts`
- Create: `apps/api/src/topology/mutations.test.ts`
- Create: `apps/api/src/routes/topology.ts`
- Modify: `apps/api/src/app.ts`

**Step 1: Write the failing test**

Write tests for:

- add node
- move node
- create network segment
- attach interface to network
- detach interface from network

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test mutations`
Expected: FAIL because the mutation service does not exist

**Step 3: Write minimal implementation**

Implement pure functions over the shared topology schema before wiring them into HTTP routes.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test mutations`
Expected: PASS

### Task 12: Add QEMU command builder

**Files:**

- Create: `apps/api/src/runtime/qemu/buildQemuCommand.ts`
- Create: `apps/api/src/runtime/qemu/buildQemuCommand.test.ts`
- Create: `apps/api/src/runtime/qemu/types.ts`

**Step 1: Write the failing test**

Create a test that builds a QEMU command for a node with:

- one `qcow2` disk
- 4 vCPU
- 8192 MB RAM
- 8 interfaces

Assert the output contains the expected machine, disk, memory, cpu, and netdev/device flags.
Also assert that the command enables hardware acceleration when the host capability flag is present.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test buildQemuCommand`
Expected: FAIL because the builder does not exist

**Step 3: Write minimal implementation**

Generate a command array, not a shell string. Include stable TAP names derived from lab ID, node ID, and interface slot. Add host acceleration flags when capabilities allow it and surface a clear error when a template requires acceleration but the host cannot provide it.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test buildQemuCommand`
Expected: PASS

### Task 13: Add container runtime command builder

**Files:**

- Create: `apps/api/src/runtime/container/buildContainerSpec.ts`
- Create: `apps/api/src/runtime/container/buildContainerSpec.test.ts`

**Step 1: Write the failing test**

Create a test that builds a container runtime spec for an Alpine utility node with CPU, memory, and interface count.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test buildContainerSpec`
Expected: FAIL because the builder does not exist

**Step 3: Write minimal implementation**

Return a structured spec with:

- image
- command
- network namespace hooks
- resource limits

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test buildContainerSpec`
Expected: PASS

### Task 14: Add host capability detection

**Files:**

- Create: `apps/api/src/runtime/hostCapabilities.ts`
- Create: `apps/api/src/runtime/hostCapabilities.test.ts`

**Step 1: Write the failing test**

Write tests that detect:

- Linux `KVM` available when `/dev/kvm` is present and accessible
- acceleration unavailable when the required device or capability is missing

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test hostCapabilities`
Expected: FAIL because the capability module does not exist

**Step 3: Write minimal implementation**

Implement a small host capability service that reports:

- `accelerationMode`
- `accelerationAvailable`
- user-facing error message when acceleration is unavailable

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test hostCapabilities`
Expected: PASS

### Task 15: Add Linux networking primitives

**Files:**

- Create: `apps/api/src/network/linux.ts`
- Create: `apps/api/src/network/linux.test.ts`
- Create: `apps/api/src/network/types.ts`

**Step 1: Write the failing test**

Write tests for pure command/spec generation for:

- creating a bridge
- creating a TAP
- creating a veth pair
- attaching an endpoint to a bridge
- detaching an endpoint

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test linux`
Expected: FAIL because the networking module does not exist

**Step 3: Write minimal implementation**

Model Linux network actions as structured operations first, then add an executor later.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test linux`
Expected: PASS

### Task 16: Implement the live wiring service

**Files:**

- Create: `apps/api/src/network/reconcileTopology.ts`
- Create: `apps/api/src/network/reconcileTopology.test.ts`
- Modify: `apps/api/src/topology/mutations.ts`

**Step 1: Write the failing test**

Given a lab with two attached interfaces on a hidden network, assert that the reconciler emits the bridge/TAP operations needed to realize the connection.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test reconcileTopology`
Expected: FAIL because the reconciler does not exist

**Step 3: Write minimal implementation**

Compare desired topology with observed host state and return the minimal operation plan.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test reconcileTopology`
Expected: PASS

### Task 17: Add runtime state repository

**Files:**

- Create: `apps/api/src/runtime/runtimeStateRepository.ts`
- Create: `apps/api/src/runtime/runtimeStateRepository.test.ts`
- Modify: `apps/api/prisma/schema.prisma`

**Step 1: Write the failing test**

Write a test that stores and reads node runtime states including `starting`, `running`, `stopped`, and `failed`.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test runtimeStateRepository`
Expected: FAIL because the repository does not exist

**Step 3: Write minimal implementation**

Persist runtime state per node separately from the lab document, including whether the node is using accelerated execution and which acceleration mode was selected.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test runtimeStateRepository`
Expected: PASS

### Task 18: Add node power endpoints

**Files:**

- Create: `apps/api/src/runtime/powerNode.ts`
- Create: `apps/api/src/runtime/powerNode.test.ts`
- Create: `apps/api/src/routes/runtime.ts`
- Modify: `apps/api/src/app.ts`

**Step 1: Write the failing test**

Write tests that:

- power on a QEMU node by generating a start request
- power on a container node by generating a container start request
- power off both kinds cleanly

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test powerNode`
Expected: FAIL because the service does not exist

**Step 3: Write minimal implementation**

Implement runtime dispatch based on node `runtime` kind.
Load host capabilities before building VM start requests and choose the supported acceleration mode.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test powerNode`
Expected: PASS

### Task 19: Add the reconciler loop shell

**Files:**

- Create: `apps/api/src/reconciler/runReconciler.ts`
- Create: `apps/api/src/reconciler/runReconciler.test.ts`
- Modify: `apps/api/src/server.ts`

**Step 1: Write the failing test**

Write a test that verifies the reconciler requests topology reconciliation for all active labs on a timer tick.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test runReconciler`
Expected: FAIL because the loop does not exist

**Step 3: Write minimal implementation**

Implement a timer-driven loop that loads desired lab state and delegates to the reconciliation service.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test runReconciler`
Expected: PASS

### Task 20: Bootstrap the web app shell

**Files:**

- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/App.test.tsx`
- Modify: `apps/web/package.json`

**Step 1: Write the failing test**

Write a test that renders the app shell and expects `NetworkChum` and `Labs` to be visible.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/web test`
Expected: FAIL because the app shell does not exist

**Step 3: Write minimal implementation**

Create a minimal React app with placeholders for the catalog, canvas, and console pane.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/web test`
Expected: PASS

### Task 21: Add lab browser UI

**Files:**

- Create: `apps/web/src/features/labs/LabBrowser.tsx`
- Create: `apps/web/src/features/labs/LabBrowser.test.tsx`
- Create: `apps/web/src/lib/api.ts`

**Step 1: Write the failing test**

Render the lab browser with mocked API data and assert that a lab name appears in the list.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/web test LabBrowser`
Expected: FAIL because the component does not exist

**Step 3: Write minimal implementation**

Implement a list-first lab browser with create/open actions.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/web test LabBrowser`
Expected: PASS

### Task 22: Add device catalog UI

**Files:**

- Create: `apps/web/src/features/catalog/DeviceCatalog.tsx`
- Create: `apps/web/src/features/catalog/DeviceCatalog.test.tsx`
- Modify: `apps/web/src/lib/api.ts`

**Step 1: Write the failing test**

Render the device catalog with mocked entries for a Cisco ASR and an Alpine container and assert that both names appear.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/web test DeviceCatalog`
Expected: FAIL because the component does not exist

**Step 3: Write minimal implementation**

Implement grouped catalog rendering with a callback to open the add-node form.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/web test DeviceCatalog`
Expected: PASS

### Task 23: Add node configuration form

**Files:**

- Create: `apps/web/src/features/catalog/AddNodeDialog.tsx`
- Create: `apps/web/src/features/catalog/AddNodeDialog.test.tsx`

**Step 1: Write the failing test**

Render an add-node dialog for `Cisco ASR` and assert that RAM, vCPU, and interface count inputs are editable.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/web test AddNodeDialog`
Expected: FAIL because the dialog does not exist

**Step 3: Write minimal implementation**

Generate the form from template field metadata rather than hardcoded vendor fields.
Include a non-editable or lightly editable acceleration field showing that VM templates default to host acceleration, with `KVM` as the Linux target.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/web test AddNodeDialog`
Expected: PASS

### Task 24: Add topology canvas rendering

**Files:**

- Create: `apps/web/src/features/topology/TopologyCanvas.tsx`
- Create: `apps/web/src/features/topology/TopologyCanvas.test.tsx`
- Create: `apps/web/src/features/topology/renderTopology.ts`

**Step 1: Write the failing test**

Render a topology with two nodes connected through one hidden network and assert that two node labels and one visible cable line are shown.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/web test TopologyCanvas`
Expected: FAIL because the canvas does not exist

**Step 3: Write minimal implementation**

Translate the JSON topology model into visual nodes and visible edge lines for two-ended segments.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/web test TopologyCanvas`
Expected: PASS

### Task 25: Add live cable interaction UI

**Files:**

- Create: `apps/web/src/features/topology/useCableTool.ts`
- Create: `apps/web/src/features/topology/useCableTool.test.ts`
- Modify: `apps/web/src/features/topology/TopologyCanvas.tsx`

**Step 1: Write the failing test**

Test that selecting two interfaces produces an API request to attach both endpoints to the same hidden network segment.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/web test useCableTool`
Expected: FAIL because the hook does not exist

**Step 3: Write minimal implementation**

Implement the cable tool as a thin client over topology mutation endpoints.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/web test useCableTool`
Expected: PASS

### Task 26: Add console panel UI

**Files:**

- Create: `apps/web/src/features/console/ConsoleTabs.tsx`
- Create: `apps/web/src/features/console/ConsoleTabs.test.tsx`

**Step 1: Write the failing test**

Render console tabs with two mocked sessions and assert the tabs are visible and switchable.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/web test ConsoleTabs`
Expected: FAIL because the component does not exist

**Step 3: Write minimal implementation**

Implement browser tab management only. Real console transport can be wired after the UI shape is stable.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/web test ConsoleTabs`
Expected: PASS

### Task 27: Add end-to-end API smoke tests

**Files:**

- Create: `apps/api/test/labLifecycle.test.ts`

**Step 1: Write the failing test**

Cover this full flow:

- create lab
- scan images
- bind image to template
- build catalog
- add node
- create connection
- power on node

Stub runtime execution where needed.
Assert that VM power-on requests include host acceleration when capability is available.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/api test labLifecycle`
Expected: FAIL until all dependencies are wired

**Step 3: Write minimal implementation**

Wire the existing services together through the app layer.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/api test labLifecycle`
Expected: PASS

### Task 28: Add end-to-end web smoke tests

**Files:**

- Create: `apps/web/e2e/topology.spec.ts`
- Modify: `apps/web/package.json`

**Step 1: Write the failing test**

Use Playwright to automate:

- open app
- create lab
- open catalog
- add a node
- draw a cable

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @networkchum/web test:e2e`
Expected: FAIL before the UI flow is complete

**Step 3: Write minimal implementation**

Fill the missing UI wiring needed for the smoke flow.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @networkchum/web test:e2e`
Expected: PASS

### Task 29: Add operator documentation

**Files:**

- Create: `README.md`
- Create: `docs/images.md`
- Create: `docs/runtime.md`

**Step 1: Write the docs**

Document:

- how to install dependencies
- how to run the API and web app
- where to place `qcow2` images
- how templates map images into the catalog
- how operators assign scanned images to built-in templates
- that Linux production VM acceleration requires `KVM` support and `/dev/kvm` access
- that other acceleration modes may be added later for non-Linux development hosts
- current v1 limitations

**Step 2: Verify docs against the code**

Run the setup steps exactly as written.
Expected: all commands match the repository structure and succeed

### Task 30: Final verification

**Files:**

- No file changes expected

**Step 1: Run unit tests**

Run: `pnpm test`
Expected: PASS

**Step 2: Run builds**

Run: `pnpm build`
Expected: PASS

**Step 3: Run the app locally**

Run: `pnpm dev`
Expected: web app and API both start without configuration errors

**Step 4: Manual smoke check**

Verify:

- the catalog loads
- a lab can be created
- a node can be added
- a cable can be drawn
- a power action updates node state
- VM nodes report accelerated execution on hosts with supported acceleration
