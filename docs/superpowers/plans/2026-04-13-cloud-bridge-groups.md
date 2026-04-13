# Cloud Bridge Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cloud-node `Host Bridge` selection with a role-plus-group model that creates and reuses app-owned bridges for management, private circuit, and ISP carrier clouds.

**Architecture:** Cloud nodes will move from a raw `bridgeInterface` field to `cloudRole` plus `bridgeGroup`, backed by a managed-bridge registry in API data. The backend will resolve or create app-owned bridges per role/group and attach TAP-backed lab networks to those bridges, while the UI will expose role/group editing instead of pre-existing-bridge selection.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest, Vite

---

## File Map

- Modify: `packages/shared/src/topology.ts`
  - add shared schema for `cloudRole` and `bridgeGroup`
  - keep backward compatibility for legacy `bridgeInterface`
- Modify: `packages/shared/src/topology.test.ts`
  - cover cloud-node schema normalization
- Modify: `apps/api/src/topology/mutations.ts`
  - add cloud role/group support to node creation and settings updates
- Modify: `apps/api/src/topology/mutations.test.ts`
  - cover creation and update behavior
- Create: `apps/api/src/network/managedBridgeStore.ts`
  - persist app-owned bridge records in API data
- Modify: `apps/api/src/network/cloudUplink.ts`
  - resolve managed bridge names from role/group
  - create bridge metadata helpers and legacy normalization helpers
- Modify: `apps/api/src/network/reconcileTopology.ts`
  - create managed bridge operations when a cloud-backed network resolves to an app-owned bridge
- Modify: `apps/api/src/network/reconcileTopology.test.ts`
  - cover managed bridge creation/reuse behavior
- Modify: `apps/api/src/network/liveTapTopology.ts`
  - sync running nodes using managed bridge resolution instead of legacy raw bridge strings
- Modify: `apps/api/src/network/liveTapTopology.test.ts`
  - cover cloud settings changes between groups
- Modify: `apps/api/src/runtime/powerNode.ts`
  - ensure bridge registry/creation runs during cloud-backed TAP setup
- Modify: `apps/api/src/runtime/powerNode.test.ts`
  - cover first-create and reuse paths
- Modify: `apps/api/src/routes/labs.ts`
  - accept cloud role/group fields
  - replace `/host/interfaces` with a managed-cloud metadata endpoint or remove if unused
  - validate cloud settings using the new model
- Modify: `apps/api/src/app.ts`
  - extend test dependency surface for managed bridge operations if needed
- Modify: `apps/api/src/app.test.ts`
  - cover create/update API behavior for cloud role/group
- Modify: `apps/web/src/api/client.ts`
  - replace bridge-interface payloads with cloud role/group payloads
- Modify: `apps/web/src/components/AddNodeDialog.tsx`
  - add `Cloud Role` dropdown and `Bridge Group` input
- Modify: `apps/web/src/components/AddNodeDialog.test.tsx`
  - cover defaults and payload shape
- Modify: `apps/web/src/components/CloudNodeSettingsDialog.tsx`
  - edit cloud role/group instead of host bridge
- Modify: `apps/web/src/App.tsx`
  - thread cloud role/group state through dialogs and API calls
- Modify: `apps/web/src/App.test.tsx`
  - cover create/edit cloud workflows
- Modify: `README.md`
  - document managed management bridge behavior
- Modify: `INSTALL.md`
  - clarify that management/private bridges are app-owned and internal by default

## Task 1: Add Shared Cloud Role And Group Schema

**Files:**

- Modify: `packages/shared/src/topology.ts`
- Test: `packages/shared/src/topology.test.ts`

- [ ] **Step 1: Write the failing shared-schema tests**

Add tests for:

- a cloud node with `cloudRole: "management"` and `bridgeGroup: "management"`
- normalization of legacy `bridgeInterface: "br-mgmt"` into `cloudRole`/`bridgeGroup`

- [ ] **Step 2: Run shared schema tests to verify failure**

Run: `npm run test --workspace @networkchum/shared -- src/topology.test.ts`

Expected: FAIL because `cloudRole` and `bridgeGroup` are not modeled yet.

- [ ] **Step 3: Implement minimal schema support**

Add:

- `CloudRoleSchema`
- optional `cloudRole` and `bridgeGroup` to node config
- transform logic that preserves current nodes and normalizes compatible legacy cloud config

- [ ] **Step 4: Re-run shared schema tests**

Run: `npm run test --workspace @networkchum/shared -- src/topology.test.ts`

Expected: PASS

## Task 2: Update Node Mutation And Persistence Paths

**Files:**

- Modify: `apps/api/src/topology/mutations.ts`
- Test: `apps/api/src/topology/mutations.test.ts`

- [ ] **Step 1: Write failing mutation tests**

Add tests that:

- `addNode` stores `cloudRole` and `bridgeGroup` on cloud nodes
- settings updates change role/group without touching other config

- [ ] **Step 2: Run mutation tests to verify failure**

Run: `npm run test --workspace @networkchum/api -- src/topology/mutations.test.ts`

Expected: FAIL because mutations still only understand `bridgeInterface`.

- [ ] **Step 3: Implement minimal mutation changes**

Extend mutation inputs and setters to persist:

- `cloudRole`
- `bridgeGroup`

Keep legacy `bridgeInterface` compatibility only where still needed during migration.

- [ ] **Step 4: Re-run mutation tests**

Run: `npm run test --workspace @networkchum/api -- src/topology/mutations.test.ts`

Expected: PASS

## Task 3: Add Managed Bridge Registry And Resolution

**Files:**

- Create: `apps/api/src/network/managedBridgeStore.ts`
- Modify: `apps/api/src/network/cloudUplink.ts`
- Test: `apps/api/src/network/cloudUplink.test.ts`

- [ ] **Step 1: Write failing managed-bridge tests**

Add tests for:

- management role/group resolves to deterministic app-owned bridge name
- private role/group resolves to a separate deterministic bridge
- first resolution creates a registry entry
- later resolution reuses the same bridge entry

- [ ] **Step 2: Run cloud uplink tests to verify failure**

Run: `npm run test --workspace @networkchum/api -- src/network/cloudUplink.test.ts`

Expected: FAIL because there is no managed bridge registry or role/group resolver.

- [ ] **Step 3: Implement minimal registry and resolver**

Create a store for managed bridges and add helpers in `cloudUplink.ts` for:

- legacy cloud config normalization
- deterministic bridge-name generation
- role/group-based registry lookup and creation

- [ ] **Step 4: Re-run cloud uplink tests**

Run: `npm run test --workspace @networkchum/api -- src/network/cloudUplink.test.ts`

Expected: PASS

## Task 4: Teach TAP Topology To Create And Reuse Managed Bridges

**Files:**

- Modify: `apps/api/src/network/reconcileTopology.ts`
- Modify: `apps/api/src/network/liveTapTopology.ts`
- Test: `apps/api/src/network/reconcileTopology.test.ts`
- Test: `apps/api/src/network/liveTapTopology.test.ts`
- Test: `apps/api/src/runtime/powerNode.test.ts`

- [ ] **Step 1: Write failing topology tests**

Add tests for:

- a first management cloud causing a managed bridge create op
- a second cloud in the same role/group reusing the same bridge
- a settings change from one private group to another moving attached TAPs to the new bridge

- [ ] **Step 2: Run topology/runtime tests to verify failure**

Run: `npm run test --workspace @networkchum/api -- src/network/reconcileTopology.test.ts src/network/liveTapTopology.test.ts src/runtime/powerNode.test.ts`

Expected: FAIL because topology still expects pre-existing bridge strings.

- [ ] **Step 3: Implement minimal topology changes**

Change bridge resolution so:

- managed bridges can be created as part of reconciliation
- cloud-backed networks attach TAPs to the resolved managed bridge
- running-node sync uses role/group-derived bridge targets

- [ ] **Step 4: Re-run topology/runtime tests**

Run: `npm run test --workspace @networkchum/api -- src/network/reconcileTopology.test.ts src/network/liveTapTopology.test.ts src/runtime/powerNode.test.ts`

Expected: PASS

## Task 5: Update API Contracts For Cloud Role And Group

**Files:**

- Modify: `apps/api/src/routes/labs.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write failing API tests**

Add tests for:

- creating a cloud node with `cloudRole` and `bridgeGroup`
- editing a cloud node's role/group
- legacy bridge-interface payloads being normalized or rejected intentionally

- [ ] **Step 2: Run API tests to verify failure**

Run: `npm run test --workspace @networkchum/api -- src/app.test.ts`

Expected: FAIL because routes still accept `bridgeInterface`.

- [ ] **Step 3: Implement minimal route changes**

Update request schemas, handlers, and test dependency hooks to use:

- `cloudRole`
- `bridgeGroup`

Remove pre-existing-host-bridge-only validation for app-owned managed bridge flows.

- [ ] **Step 4: Re-run API tests**

Run: `npm run test --workspace @networkchum/api -- src/app.test.ts`

Expected: PASS

## Task 6: Replace Cloud UI With Role And Group Editing

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/components/AddNodeDialog.tsx`
- Modify: `apps/web/src/components/AddNodeDialog.test.tsx`
- Modify: `apps/web/src/components/CloudNodeSettingsDialog.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write failing web tests**

Add tests for:

- add-node dialog showing `Cloud Role` and `Bridge Group`
- management defaulting to `management`
- saving cloud settings with role/group

- [ ] **Step 2: Run web tests to verify failure**

Run: `npm run test --workspace @networkchum/web -- src/components/AddNodeDialog.test.tsx src/App.test.tsx`

Expected: FAIL because the UI still uses `Host Bridge`.

- [ ] **Step 3: Implement minimal web changes**

Replace cloud bridge selection with:

- `Cloud Role` dropdown
- `Bridge Group` input

Update API payloads and state wiring in `App.tsx`.

- [ ] **Step 4: Re-run web tests**

Run: `npm run test --workspace @networkchum/web -- src/components/AddNodeDialog.test.tsx src/App.test.tsx`

Expected: PASS

## Task 7: Refresh Operator Docs And Run Full Verification

**Files:**

- Modify: `README.md`
- Modify: `INSTALL.md`

- [ ] **Step 1: Update docs**

Clarify:

- management bridges are app-owned
- first cloud in a role/group creates the bridge
- private/carrier bridges are internal-only by default
- host uplink attachment is not automatic in this pass

- [ ] **Step 2: Run focused verification**

Run:

```bash
npm run test --workspace @networkchum/shared -- src/topology.test.ts
npm run test --workspace @networkchum/api -- src/topology/mutations.test.ts src/network/cloudUplink.test.ts src/network/reconcileTopology.test.ts src/network/liveTapTopology.test.ts src/runtime/powerNode.test.ts src/app.test.ts
npm run test --workspace @networkchum/web -- src/components/AddNodeDialog.test.tsx src/App.test.tsx
npm run build --workspace @networkchum/api
npm run build --workspace @networkchum/web
```

Expected:

- all targeted tests pass
- both builds pass

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/topology.ts packages/shared/src/topology.test.ts apps/api/src/topology/mutations.ts apps/api/src/topology/mutations.test.ts apps/api/src/network/managedBridgeStore.ts apps/api/src/network/cloudUplink.ts apps/api/src/network/cloudUplink.test.ts apps/api/src/network/reconcileTopology.ts apps/api/src/network/reconcileTopology.test.ts apps/api/src/network/liveTapTopology.ts apps/api/src/network/liveTapTopology.test.ts apps/api/src/runtime/powerNode.ts apps/api/src/runtime/powerNode.test.ts apps/api/src/routes/labs.ts apps/api/src/app.ts apps/api/src/app.test.ts apps/web/src/api/client.ts apps/web/src/components/AddNodeDialog.tsx apps/web/src/components/AddNodeDialog.test.tsx apps/web/src/components/CloudNodeSettingsDialog.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx README.md INSTALL.md docs/superpowers/plans/2026-04-13-cloud-bridge-groups.md
git commit -m "Implement cloud bridge groups"
```
