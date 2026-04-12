# Console Occupancy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show whether each telnet-backed console port is free or busy and add a safe `Disconnect Native Console` action for the selected node.

**Architecture:** Extend the runtime API with a node-scoped disconnect action and richer console occupancy metadata, then thread that state into the runtime panel UI. Keep the action narrow: selected node only, external client processes only, never QEMU.

**Tech Stack:** Fastify, TypeScript, React, Vitest, Testing Library

---

### Task 1: Add failing API tests for node-scoped console disconnect

**Files:**

- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/routes/labs.ts`

**Step 1: Write the failing test**

- Add a test that `POST /labs/:labId/nodes/:nodeId/disconnect-console` kills only external client PIDs attached to that node’s `consolePort`.
- Verify QEMU is not targeted.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: FAIL because the route does not exist.

**Step 3: Write minimal implementation**

- Add the route.
- Use `lsof` on the node’s `consolePort`.
- Parse client PIDs from `ESTABLISHED` lines that are not `qemu-syst`.
- Kill only those PIDs.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

### Task 2: Add failing API tests for occupancy metadata

**Files:**

- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/routes/labs.ts`

**Step 1: Write the failing test**

- Add a test that `GET /labs/:labId/runtime` returns enough metadata for the UI to display:
  - `consolePort`
  - `consoleInUse`

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: FAIL if the shape is incomplete.

**Step 3: Write minimal implementation**

- Preserve the enriched runtime state shape with `consoleInUse` and `consolePort` so the frontend can render the indicator.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

### Task 3: Add failing web tests for console indicator and disconnect action

**Files:**

- Modify: `apps/web/src/components/LabDetails.test.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/LabDetails.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write the failing test**

- Add a `LabDetails` test that shows `Console Port: 5004` with a free/busy indicator.
- Add an `App` test that a busy selected node shows `Disconnect Native Console` and calls the new API route.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabDetails.test.tsx src/App.test.tsx`
Expected: FAIL because the indicator and action do not exist.

**Step 3: Write minimal implementation**

- Add occupancy indicator rendering in `LabDetails`.
- Add `Disconnect Native Console` button for busy telnet-backed selected nodes.
- Wire the button to the new API action and refresh runtime state afterward.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabDetails.test.tsx src/App.test.tsx`
Expected: PASS

### Task 4: Final verification

**Files:**

- Modify: none expected

**Step 1: Run API tests**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

**Step 2: Run focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabDetails.test.tsx src/App.test.tsx`
Expected: PASS

**Step 3: Run builds**

Run: `npm run build --workspace @networkchum/api && npm run build --workspace @networkchum/web`
Expected: PASS
