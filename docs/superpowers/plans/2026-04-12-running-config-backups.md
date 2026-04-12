I'm using the writing-plans skill to create the implementation plan.

# Running Config Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an API endpoint and matching UI surface so node-level running-config backups are visible to operators without editing or restoring configs.

**Architecture:** The Fastify labs router will return records from the existing running-config backup store so the web client can fetch them by lab/node ID. React state will cache the last-seen node backup list, and the existing `LabDetails` panel will render a minimal list of timestamped, status-labeled, source-named entries when a node is selected.

**Tech Stack:** TypeScript + Fastify for the API, React + Vitest for the web app, shared types via `@networkchum/shared` when applicable, and the existing running-config backup helpers under `apps/api/src/runtime`.

---

### Task 1: Add a failing API regression test for the new route

**Files:**

- Modify: `apps/api/src/app.test.ts`

**Test:** `apps/api/src/app.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("returns running-config backups for the selected node", async () => {
  const { labId, nodeId } = await createLabWithNode("node-api-backup");
  await appendRunningConfigBackupRecord({
    id: "rec-1",
    labId,
    nodeId,
    status: "captured",
    source: "Boot backup",
    createdAt: "2026-04-12T00:00:00.000Z",
  });

  const response = await app.inject({
    method: "GET",
    url: `/labs/${labId}/nodes/${nodeId}/running-config-backups`,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ backups: expect.any(Array) });
});
```

- [ ] **Step 2: Run the targeted test to confirm failure**
      Run: `npm run test --workspace @networkchum/api -- apps/api/src/app.test.ts`
      Expected: the new test fails because the route is not implemented yet (likely 404).

- [ ] **Step 3: Leave the test waiting for implementation.**

### Task 2: Implement the Fastify route to serve running-config backups

**Files:**

- Modify: `apps/api/src/routes/labs.ts`

**Test:** `apps/api/src/app.test.ts`

- [ ] **Step 1: Add `GET /labs/:labId/nodes/:nodeId/running-config-backups`**
      Parse the params with zod, call `listRunningConfigBackupRecords`, and return `{ backups }`.

- [ ] **Step 2: Rerun the targeted API test**
      Run: `npm run test --workspace @networkchum/api -- apps/api/src/app.test.ts`
      Expected: new test now passes and existing suite stays green.

### Task 3: Surface running-config backups in the web client and UI

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/LabDetails.tsx`

**Test:** `apps/web/src/App.test.tsx`

- [ ] **Step 1: Extend the API client**
      Add `listRunningConfigBackups(labId, nodeId)` returning node-specific records typed with `createdAt`, `status`, and `source`.

- [ ] **Step 2: Fetch backups in `App`**
      Track `selectedLabId`, `selectedNodeId`, and `nodeBackups` state, invoke the new client method inside a `useEffect`, and keep the records keyed by node so they can be passed to `LabDetails`.

- [ ] **Step 3: Render backups in `LabDetails`**
      Accept a prop such as `selectedNodeBackups` and show a compact list of created timestamps, status pills, and source labels when a node is focused (show a placeholder message when none exist).

- [ ] **Step 4: Run the targeted UI test pre-implementation**
      Run: `npm run test --workspace @networkchum/web -- apps/web/src/App.test.tsx`
      Expected: fails because the UI is not yet wired to show backups.

### Task 4: Add a failing UI test asserting the backup summary text

**Files:**

- Modify: `apps/web/src/App.test.tsx`

**Test:** `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write the failing test**
      Mock `api.listRunningConfigBackups` to return a record with `source: "Boot backup"` and `status: "captured"`, select the node, and expect those strings inside the node detail card.

- [ ] **Step 2: Run the targeted test**
      Run: `npm run test --workspace @networkchum/web -- apps/web/src/App.test.tsx`
      Expected: fails until Task 3 renders the backup summary.

- [ ] **Step 3: Re-run the targeted test after wiring the UI**
      Run again and expect PASS.

### Task 5: Verification

**Files:**

- None (verification step)

- [ ] **Step 1: Run the focused API suite**
      `npm run test --workspace @networkchum/api -- apps/api/src/app.test.ts`

- [ ] **Step 2: Run the focused web suite**
      `npm run test --workspace @networkchum/web -- apps/web/src/App.test.tsx`

- [ ] **Step 3: Optional manual sanity check**
      Spin up the dev server and confirm the node detail panel shows timestamp, status, and source without editing/restore controls.

After the plan review, choose between continuing inline via `superpowers:executing-plans` or dispatching subagents via `superpowers:subagent-driven-development`. Document the chosen execution path before coding.
