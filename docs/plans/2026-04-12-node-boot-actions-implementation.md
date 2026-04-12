# Node Boot Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit one-shot node boot actions so operators can choose `No Boot Action`, `Backup Running Config Once`, or `Inject Startup Config Once`, while fixing CSR normal power cycles so they preserve node state instead of wiping overlays.

**Architecture:** Extend the persisted lab topology with per-node boot-action state, thread that state through API and UI, and update `powerOnNode()` so injection depends on the queued action rather than mere presence of config text. Add a small runtime backup orchestration layer with adapter stubs so `backup-once` can schedule a post-boot running-config capture without blocking boot and with clean error reporting.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest, existing file-backed lab/runtime stores

---

## File Map

### Shared model

- Modify: `packages/shared/src/topology.ts`
  - Add `NodeBootAction` schema/type
  - Add `NodeBootActionState` schema/type
  - Extend `LabDocumentSchema` with `nodeBootActions`

### API mutations and routes

- Modify: `apps/api/src/topology/mutations.ts`
  - Add helpers to upsert/clear a node boot action
  - Ensure node deletion removes stale boot-action entries
- Modify: `apps/api/src/topology/mutations.test.ts`
  - Add tests for boot-action mutation helpers
- Modify: `apps/api/src/routes/labs.ts`
  - Add route to set node boot action
  - Return updated lab document including boot actions
- Modify: `apps/api/src/app.test.ts`
  - Add integration tests for route behavior and persisted lab response shape

### Runtime boot orchestration

- Modify: `apps/api/src/runtime/powerNode.ts`
  - Resolve node boot action
  - Gate config injection on `inject-once`
  - Remove CSR forced overlay reset on normal power-on
  - Clear one-shot boot action after launch attempt
  - Schedule backup-once worker
- Modify: `apps/api/src/runtime/powerNode.test.ts`
  - Add failing tests for action-gated injection
  - Add regression test preventing CSR overlay reset from config text alone
  - Add tests for one-shot action clearing and backup scheduling
- Modify: `apps/api/src/runtime/configInjectors.ts`
  - Keep injectors artifact-only; update comments to reflect no forced overlay reset policy

### Running-config backup framework

- Create: `apps/api/src/runtime/runningConfigBackup.ts`
  - Coordinator API for scheduling one-shot backup attempts
- Create: `apps/api/src/runtime/runningConfigBackupAdapters.ts`
  - Adapter interface and initial template/runtime selection
- Create: `apps/api/src/runtime/runningConfigBackupStore.ts`
  - File-backed persistence for captured configs and statuses
- Create: `apps/api/src/runtime/runningConfigBackup.test.ts`
  - Unit tests for coordinator and unsupported-template behavior

### Web API client and UI

- Modify: `apps/web/src/api/client.ts`
  - Add client method to set node boot action
  - Extend lab document types with `nodeBootActions`
- Modify: `apps/web/src/App.tsx`
  - Thread node boot action through selected lab state
  - Wire dialog save flow to set config and boot action
- Modify: `apps/web/src/App.test.tsx`
  - Add tests for dialog/API flow and state refresh
- Modify: `apps/web/src/components/StartupConfigDialog.tsx`
  - Replace implicit text-only save behavior with explicit `Next Power-Up Action` dropdown
- Create or Modify: `apps/web/src/components/StartupConfigDialog.test.tsx`
  - Add focused dialog tests if not already present

### Documentation

- Modify: `README.md`
  - Explain startup-config storage vs one-shot boot actions
  - Explain running-config backup once behavior
- Modify: `INSTALL.md`
  - Note runtime backup prerequisites if adapter support needs host tools later

## Task 1: Extend Shared Topology With Node Boot Actions

**Files:**

- Modify: `packages/shared/src/topology.ts`
- Test: `apps/api/src/topology/mutations.test.ts`

- [ ] **Step 1: Write the failing mutation test for persisted boot-action state**

Add a test case in `apps/api/src/topology/mutations.test.ts` that constructs a `LabDocument` with `nodeBootActions: []`, applies a new mutation helper, and expects:

```ts
expect(result.nodeBootActions).toEqual([
  { nodeId: "node-a", action: "inject-once" },
]);
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/topology/mutations.test.ts -t "boot action"
```

Expected: FAIL because no boot-action mutation helper or shared schema field exists yet.

- [ ] **Step 3: Add shared schema and type support**

In `packages/shared/src/topology.ts`, add:

```ts
export const NodeBootActionSchema = z.enum([
  "none",
  "backup-once",
  "inject-once",
]);

export const NodeBootActionStateSchema = z.object({
  nodeId: z.string().min(1),
  action: NodeBootActionSchema,
  updatedAt: z.string().min(1).optional(),
});
```

Extend `LabDocumentSchema` with:

```ts
nodeBootActions: z.array(NodeBootActionStateSchema).default([]),
```

Export both inferred types.

- [ ] **Step 4: Update test fixtures that construct `LabDocument`**

Adjust `makeDocument()` in `apps/api/src/topology/mutations.test.ts` and any other direct fixtures to include:

```ts
nodeBootActions: [],
```

- [ ] **Step 5: Run the targeted test to verify the schema change passes baseline compilation**

Run:

```bash
npm run test --workspace @networkchum/api -- src/topology/mutations.test.ts
```

Expected: PASS for existing mutation tests, with the new boot-action test still failing until the helper is implemented.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/topology.ts apps/api/src/topology/mutations.test.ts
git commit -m "feat: add node boot action schema"
```

## Task 2: Add Node Boot Action Mutation Helpers

**Files:**

- Modify: `apps/api/src/topology/mutations.ts`
- Test: `apps/api/src/topology/mutations.test.ts`

- [ ] **Step 1: Write the failing tests for upsert and clear behavior**

Add tests for:

```ts
const updated = setNodeBootAction(doc, "node-a", "inject-once");
expect(updated.nodeBootActions).toEqual([
  { nodeId: "node-a", action: "inject-once" },
]);

const cleared = setNodeBootAction(updated, "node-a", "none");
expect(cleared.nodeBootActions).toEqual([]);
```

Also add a regression test ensuring `removeNode()` removes any matching boot-action state.

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/topology/mutations.test.ts -t "boot action|removeNode"
```

Expected: FAIL because `setNodeBootAction()` does not exist and `removeNode()` does not clean boot-action state.

- [ ] **Step 3: Implement minimal mutation helpers**

In `apps/api/src/topology/mutations.ts`, add:

```ts
export function setNodeBootAction(
  document: LabDocument,
  nodeId: string,
  action: NodeBootAction,
): LabDocument;
```

Behavior:

- if `action === "none"`, remove the record for that node
- otherwise upsert one record for that node with `updatedAt: new Date().toISOString()`

Also update `removeNode()` to filter `document.nodeBootActions`.

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run:

```bash
npm run test --workspace @networkchum/api -- src/topology/mutations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/topology/mutations.ts apps/api/src/topology/mutations.test.ts
git commit -m "feat: add node boot action mutations"
```

## Task 3: Add API Route For Node Boot Actions

**Files:**

- Modify: `apps/api/src/routes/labs.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write the failing API integration test**

Add an `app.test.ts` case that:

1. creates a lab
2. adds a node
3. `PATCH`es `/labs/:labId/nodes/:nodeId/boot-action` with `{ action: "inject-once" }`
4. fetches the lab
5. expects:

```ts
expect(payload.lab.document.nodeBootActions).toEqual([
  expect.objectContaining({ nodeId, action: "inject-once" }),
]);
```

Add another test for clearing via `{ action: "none" }`.

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/app.test.ts -t "boot action"
```

Expected: FAIL with route not found or response shape mismatch.

- [ ] **Step 3: Implement the route**

In `apps/api/src/routes/labs.ts`:

- add a Zod schema:

```ts
const setNodeBootActionSchema = z.object({
  action: z.enum(["none", "backup-once", "inject-once"]),
});
```

- add route:

```ts
app.patch("/labs/:labId/nodes/:nodeId/boot-action", async ...)
```

Flow:

- fetch lab
- ensure node exists
- apply `setNodeBootAction()`
- persist with `updateLabDocument()`
- write lab backup if enabled
- return `{ lab: updatedLab }`

- [ ] **Step 4: Run the targeted API tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/app.test.ts -t "boot action"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/labs.ts apps/api/src/app.test.ts
git commit -m "feat: add node boot action api route"
```

## Task 4: Gate Startup-Config Injection On Explicit Boot Action

**Files:**

- Modify: `apps/api/src/runtime/powerNode.ts`
- Modify: `apps/api/src/runtime/powerNode.test.ts`

- [ ] **Step 1: Write the failing regression tests for CSR power-on**

Add tests that set up a CSR node with startup-config text present but:

- no boot action
- boot action `inject-once`

Expected assertions:

```ts
expect(state.commandPreview.join(" ")).not.toContain(`${nodeId}-startup.img`);
expect(logSpy).not.toHaveBeenCalledWith(
  expect.stringContaining("resetting overlay for day-0 config injection"),
);
```

and for `inject-once`:

```ts
expect(state.commandPreview.join(" ")).toContain(`${nodeId}-startup.img`);
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/runtime/powerNode.test.ts -t "CSR|boot action|overlay"
```

Expected: FAIL because injection is still driven by config text and overlay reset logic.

- [ ] **Step 3: Update power-on resolution logic**

In `apps/api/src/runtime/powerNode.ts`:

- resolve node boot action:

```ts
const bootAction =
  lab.document.nodeBootActions?.find((entry) => entry.nodeId === nodeId)
    ?.action ?? "none";
```

- change `needsFreshOverlay` semantics so normal power-on does not force overlay reset for `csr1000v-vfat`
- compute `shouldInjectStartupConfig` as:

```ts
const shouldInjectStartupConfig =
  bootAction === "inject-once" &&
  startupConfig !== undefined &&
  startupConfig.trim().length > 0;
```

- gate injector calls on `shouldInjectStartupConfig`

- [ ] **Step 4: Update comments in `configInjectors.ts` and `powerNode.ts`**

Replace misleading day-0 reset commentary with wording that says:

- config injectors build artifacts only
- normal power cycles preserve overlay state
- destructive reprovisioning is a future separate action

- [ ] **Step 5: Run the targeted power-on tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/runtime/powerNode.test.ts -t "CSR|boot action|overlay"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/runtime/powerNode.ts apps/api/src/runtime/powerNode.test.ts apps/api/src/runtime/configInjectors.ts
git commit -m "fix: gate csr config injection on explicit boot action"
```

## Task 5: Auto-Clear One-Shot Boot Actions After Launch Attempt

**Files:**

- Modify: `apps/api/src/runtime/powerNode.ts`
- Modify: `apps/api/src/runtime/powerNode.test.ts`
- Modify: `apps/api/src/routes/labs.ts` (only if helper import/usage changes)

- [ ] **Step 1: Write the failing tests for one-shot action clearing**

Add tests asserting that after `powerOnNode()` is called:

```ts
const updatedLab = await getLab(lab.id);
expect(updatedLab?.document.nodeBootActions).toEqual([]);
```

Cover:

- `inject-once` clears after launch attempt
- `backup-once` clears after scheduling
- blank config with `inject-once` still clears

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/runtime/powerNode.test.ts -t "clears|inject-once|backup-once"
```

Expected: FAIL because boot actions are not yet persisted back out of `powerOnNode()`.

- [ ] **Step 3: Implement minimal clear-once behavior**

In `apps/api/src/runtime/powerNode.ts`:

- before returning from all successful/failed launch-attempt paths after boot action resolution, clear the node boot action by persisting a lab document update via `updateLabDocument()`
- do this after launch attempt begins / backup scheduling is requested, not after backup completion
- keep action clearing best-effort and do not hide the original runtime result if the clear fails

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run:

```bash
npm run test --workspace @networkchum/api -- src/runtime/powerNode.test.ts -t "clears|inject-once|backup-once"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/runtime/powerNode.ts apps/api/src/runtime/powerNode.test.ts
git commit -m "feat: auto-clear one-shot node boot actions"
```

## Task 6: Add Running-Config Backup Persistence

**Files:**

- Create: `apps/api/src/runtime/runningConfigBackupStore.ts`
- Test: `apps/api/src/runtime/runningConfigBackup.test.ts`

- [ ] **Step 1: Write the failing store test**

Create `apps/api/src/runtime/runningConfigBackup.test.ts` with a persistence test:

```ts
await writeRunningConfigBackup({
  labId: "lab-1",
  nodeId: "node-1",
  status: "captured",
  source: "boot backup",
  config: "hostname edge-1\n",
});

const backups = await listRunningConfigBackups("lab-1", "node-1");
expect(backups[0]?.config).toContain("hostname edge-1");
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/runtime/runningConfigBackup.test.ts
```

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement the minimal file-backed store**

In `apps/api/src/runtime/runningConfigBackupStore.ts` create:

- `writeRunningConfigBackup(record)`
- `listRunningConfigBackups(labId, nodeId)`

Suggested stored record:

```ts
type RunningConfigBackupRecord = {
  id: string;
  labId: string;
  nodeId: string;
  status: "captured" | "failed" | "unsupported";
  source: "boot backup";
  createdAt: string;
  config?: string;
  error?: string;
};
```

Persist under the existing data dir in a dedicated subfolder, for example:

```text
${NETWORKCHUM_DATA_DIR}/running-config-backups/<labId>/<nodeId>.json
```

- [ ] **Step 4: Run the store tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/runtime/runningConfigBackup.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/runtime/runningConfigBackupStore.ts apps/api/src/runtime/runningConfigBackup.test.ts
git commit -m "feat: add running config backup store"
```

## Task 7: Add Backup Coordinator And Unsupported-Platform Baseline

**Files:**

- Create: `apps/api/src/runtime/runningConfigBackupAdapters.ts`
- Create: `apps/api/src/runtime/runningConfigBackup.ts`
- Modify: `apps/api/src/runtime/runningConfigBackup.test.ts`

- [ ] **Step 1: Write the failing coordinator test**

Add tests for:

- unsupported template writes an `unsupported` backup record
- adapter success writes `captured`
- adapter error writes `failed`

Example:

```ts
await scheduleRunningConfigBackup({
  labId: "lab-1",
  node,
  runtimeState,
});

const backups = await listRunningConfigBackups("lab-1", node.id);
expect(backups[0]?.status).toBe("unsupported");
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/runtime/runningConfigBackup.test.ts -t "unsupported|captured|failed"
```

Expected: FAIL because the coordinator and adapters do not exist.

- [ ] **Step 3: Implement minimal adapter contract**

In `apps/api/src/runtime/runningConfigBackupAdapters.ts`, define:

```ts
export type RunningConfigBackupAdapter = {
  templateIds?: string[];
  supportsNode: (node: LabNode) => boolean;
  captureRunningConfig: (context: BackupContext) => Promise<string>;
};
```

For this iteration:

- create a generic unsupported default
- optionally add stub adapters for `cisco-asr` and `arista-veos` that currently throw `"Not implemented"` so the coordinator path is structured without pretending capture already works

- [ ] **Step 4: Implement the coordinator**

In `apps/api/src/runtime/runningConfigBackup.ts`:

- select an adapter
- run capture in a fire-and-forget safe wrapper
- persist `unsupported`, `captured`, or `failed` via the backup store
- never throw back into the boot path

- [ ] **Step 5: Run the backup tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/runtime/runningConfigBackup.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/runtime/runningConfigBackup.ts apps/api/src/runtime/runningConfigBackupAdapters.ts apps/api/src/runtime/runningConfigBackup.test.ts
git commit -m "feat: add boot-time running config backup coordinator"
```

## Task 8: Schedule Backup-Once From `powerOnNode()`

**Files:**

- Modify: `apps/api/src/runtime/powerNode.ts`
- Modify: `apps/api/src/runtime/powerNode.test.ts`

- [ ] **Step 1: Write the failing scheduling test**

Add a `powerNode.test.ts` case that injects a fake backup scheduler dependency and expects it to be called once when boot action is `backup-once`:

```ts
const scheduleBackup = vi.fn(async () => undefined);
await powerOnNode(lab.id, nodeId, { ..., scheduleRunningConfigBackup: scheduleBackup });
expect(scheduleBackup).toHaveBeenCalledWith(
  expect.objectContaining({ labId: lab.id, nodeId }),
);
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/api -- src/runtime/powerNode.test.ts -t "backup-once"
```

Expected: FAIL because `powerOnNode()` does not schedule backups.

- [ ] **Step 3: Implement minimal scheduling integration**

In `apps/api/src/runtime/powerNode.ts`:

- add injectable dependency, e.g. `scheduleRunningConfigBackup`
- after successful launch attempt, if boot action is `backup-once`, call the scheduler with:
  - lab id
  - node id
  - node/template
  - runtime state / console port / command preview as needed

- [ ] **Step 4: Run the targeted test**

Run:

```bash
npm run test --workspace @networkchum/api -- src/runtime/powerNode.test.ts -t "backup-once"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/runtime/powerNode.ts apps/api/src/runtime/powerNode.test.ts
git commit -m "feat: schedule one-shot running config backups on boot"
```

## Task 9: Add Web API Client Support For Node Boot Actions

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write the failing client/UI test**

Add an `App.test.tsx` case that saves startup config with a selected next boot action and expects the API client to call:

```ts
setNodeBootAction(labId, nodeId, "inject-once");
```

or:

```ts
setNodeBootAction(labId, nodeId, "backup-once");
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/web -- src/App.test.tsx -t "Next Power-Up Action|boot action"
```

Expected: FAIL because no client method or UI wiring exists.

- [ ] **Step 3: Implement the client method**

In `apps/web/src/api/client.ts` add:

```ts
setNodeBootAction: async (labId: string, nodeId: string, action: NodeBootAction) => { ... }
```

with:

```ts
await fetchJson(`/labs/${labId}/nodes/${nodeId}/boot-action`, {
  method: "PATCH",
  body: JSON.stringify({ action }),
});
```

Also extend client-side lab document typing to include `nodeBootActions`.

- [ ] **Step 4: Run the targeted test again**

Run:

```bash
npm run test --workspace @networkchum/web -- src/App.test.tsx -t "Next Power-Up Action|boot action"
```

Expected: still FAIL until the dialog/App wiring is added.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/App.test.tsx
git commit -m "feat: add web client support for node boot actions"
```

## Task 10: Replace Startup Config Dialog Save Flow With Explicit Boot-Action Dropdown

**Files:**

- Modify: `apps/web/src/components/StartupConfigDialog.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Create or Modify: `apps/web/src/components/StartupConfigDialog.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

Add tests that verify:

- dialog renders `Next Power-Up Action`
- options are:

```text
No Boot Action
Backup Running Config Once
Inject Startup Config Once
```

- saving with selected `Inject Startup Config Once`:
  - saves config text
  - calls `setNodeBootAction(..., "inject-once")`
- saving with selected `No Boot Action`:
  - saves config text
  - calls `setNodeBootAction(..., "none")`

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
npm run test --workspace @networkchum/web -- src/App.test.tsx -t "Startup Config|Next Power-Up Action"
```

Expected: FAIL because the dialog has no dropdown and `App` only saves config text.

- [ ] **Step 3: Update the dialog component**

In `apps/web/src/components/StartupConfigDialog.tsx`:

- add prop:

```ts
initialBootAction: "none" | "backup-once" | "inject-once";
onSave: (nodeId: string, config: string, action: NodeBootAction) =>
  Promise<void>;
```

- render a `<select aria-label="Next Power-Up Action">`
- change helper text from implicit injection language to explicit action language

- [ ] **Step 4: Update `App.tsx` dialog wiring**

In `apps/web/src/App.tsx`:

- resolve the node’s current queued action from `selectedLab.document.nodeBootActions`
- pass that into the dialog
- update save handler to:
  1. ensure active config set exists
  2. save config text with `setNodeConfig()`
  3. set node boot action with `setNodeBootAction()`
  4. refresh/apply returned lab state

- [ ] **Step 5: Run the targeted UI tests**

Run:

```bash
npm run test --workspace @networkchum/web -- src/App.test.tsx -t "Startup Config|Next Power-Up Action"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/StartupConfigDialog.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: add explicit next power-up action selection to startup config ui"
```

## Task 11: Expose Backup Records To The UI

**Files:**

- Modify: `apps/api/src/routes/labs.ts` or create dedicated backup routes
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write the failing API/UI tests for backup visibility**

Start small: fetch node backup records through either lab detail enrichment or a dedicated endpoint and assert the UI can render a captured record summary like:

```text
Boot backup
Captured
```

- [ ] **Step 2: Run the targeted tests to verify failure**

Run:

```bash
npm run test --workspace @networkchum/api -- src/app.test.ts -t "running config backup"
npm run test --workspace @networkchum/web -- src/App.test.tsx -t "Boot backup|Captured"
```

Expected: FAIL because the API does not yet expose backup records.

- [ ] **Step 3: Implement the thinnest API exposure**

Prefer a dedicated route for clarity:

```text
GET /labs/:labId/nodes/:nodeId/running-config-backups
```

Return:

```json
{ "backups": [...] }
```

- [ ] **Step 4: Wire the UI to fetch and show a basic list**

Render a small node-level section with:

- timestamp
- status
- source

No editing features yet.

- [ ] **Step 5: Run the targeted tests**

Run:

```bash
npm run test --workspace @networkchum/api -- src/app.test.ts -t "running config backup"
npm run test --workspace @networkchum/web -- src/App.test.tsx -t "Boot backup|Captured"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/labs.ts apps/api/src/app.test.ts apps/web/src/api/client.ts apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: surface running config backups in api and ui"
```

## Task 12: Update Documentation

**Files:**

- Modify: `README.md`
- Modify: `INSTALL.md`

- [ ] **Step 1: Write the docs changes**

Document:

- startup-config text is stored independently of boot action
- `Next Power-Up Action` meanings
- `Inject Startup Config Once` is one-shot and auto-clears
- `Backup Running Config Once` is one-shot and auto-clears
- normal power cycles preserve device state
- unsupported platforms may report backup unsupported without blocking boot

- [ ] **Step 2: Verify docs mention the CSR behavior fix**

Search for stale wording like “startup config is always attached on power-on” and remove it.

Run:

```bash
rg -n "startup config.*power-on|attached on power-on|cdrom drive attached" README.md INSTALL.md apps/web/src/components/StartupConfigDialog.tsx
```

Expected: only the new explicit-action wording remains.

- [ ] **Step 3: Commit**

```bash
git add README.md INSTALL.md apps/web/src/components/StartupConfigDialog.tsx
git commit -m "docs: describe one-shot node boot actions"
```

## Task 13: Full Verification Pass

**Files:**

- Test: `apps/api/src/topology/mutations.test.ts`
- Test: `apps/api/src/app.test.ts`
- Test: `apps/api/src/runtime/powerNode.test.ts`
- Test: `apps/api/src/runtime/runningConfigBackup.test.ts`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Run API topology tests**

```bash
npm run test --workspace @networkchum/api -- src/topology/mutations.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run API integration tests**

```bash
npm run test --workspace @networkchum/api -- src/app.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run runtime boot tests**

```bash
npm run test --workspace @networkchum/api -- src/runtime/powerNode.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run backup coordinator tests**

```bash
npm run test --workspace @networkchum/api -- src/runtime/runningConfigBackup.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run web tests**

```bash
npm run test --workspace @networkchum/web -- src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Optional build smoke test**

```bash
npm run build --workspace @networkchum/web
```

Expected: PASS.

- [ ] **Step 7: Manual verification checklist**

1. Start app in LAN mode.
2. Create or open a lab with a CSR node.
3. Save startup-config text but leave `Next Power-Up Action` as `No Boot Action`.
4. Power cycle the node and confirm it boots from its saved on-box config/state.
5. Set `Next Power-Up Action` to `Inject Startup Config Once`.
6. Power on and confirm the action clears afterward.
7. Power cycle again and confirm the node boots normally without state wipe.
8. Set `Next Power-Up Action` to `Backup Running Config Once`.
9. Power on and confirm the action clears and a backup record appears with success, unsupported, or failure status.

- [ ] **Step 8: Final commit**

```bash
git status --short
```

Expected: clean working tree after the implementation commits above, or one final tidy-up commit if needed.
