# Node-Level Cable Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace per-port canvas wiring with a cleaner node-level cable flow that keeps interface choice explicit in a dialog.

**Architecture:** Keep the backend wiring model unchanged, but simplify the canvas interaction model. Remove visible interface ports/labels from nodes, start cable mode from a node context-menu action, drag between nodes, then resolve source/destination interfaces in a dedicated dialog before calling the existing create-network + attach-interfaces flow.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

---

### Task 1: Add failing canvas tests for node-level cable mode

**Files:**

- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.tsx`

**Step 1: Write the failing test**

- Add a test that node context menu includes `Add Cable`.
- Add a test that choosing `Add Cable` and releasing on a second node opens an `Add Cable` dialog.
- Add a test that interface port rectangles are no longer rendered.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: FAIL because the old per-port wiring model is still present.

**Step 3: Write minimal implementation**

- Remove visible interface-port rendering from node cards.
- Add node context-menu `Add Cable`.
- Add node-to-node cable mode and dialog state.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: PASS

### Task 2: Add failing tests for dialog-based interface selection

**Files:**

- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write the failing test**

- Add a test that the `Add Cable` dialog shows source/destination node names and interface dropdowns.
- Add a test that confirming the dialog still results in the existing create-network + attach-interfaces behavior.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: FAIL because no dialog-backed interface selection exists.

**Step 3: Write minimal implementation**

- Build the dialog UI.
- Preselect first free interfaces when possible.
- On confirm, call the existing backend operations through current props.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: PASS

### Task 3: Remove obsolete port-specific interaction tests and keep disconnect behavior

**Files:**

- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.tsx`

**Step 1: Write/update failing test expectations**

- Remove tests that depend on visible port rectangles for initiating cables.
- Keep cable/link disconnect behavior via link context menus.

**Step 2: Run test to verify the suite reflects the new interaction model**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: FAIL until obsolete interaction code is removed.

**Step 3: Write minimal implementation**

- Delete obsolete port-click cable-start logic.
- Preserve link-level disconnect behavior.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: PASS

### Task 4: Final verification

**Files:**

- Modify: none expected

**Step 1: Run focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: PASS

**Step 2: Run web build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
