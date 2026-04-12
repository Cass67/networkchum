# Canvas Interaction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add canvas pan, box selection, multi-node drag, and robust edge-anchored cable labels.

**Architecture:** Extend the canvas interaction state machine so empty-canvas drag creates a selection box, `Space`+drag pans the viewport, and dragging a selected node moves the whole selected set. Recompute cable label anchor points from node rectangle edges rather than node centers.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, SVG

---

### Task 1: Add failing tests for box selection and multi-select state

**Files:**

- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.tsx`

**Step 1: Write the failing test**

- Add a test for left-drag on empty canvas creating a selection box.
- Add a test that nodes within the box become selected.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: FAIL because no box-select behavior exists.

**Step 3: Write minimal implementation**

- Add selection-box state.
- Track selected node ids.
- Render the rubber-band selection rectangle and compute inclusion on mouse up.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: PASS

### Task 2: Add failing tests for multi-node drag

**Files:**

- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.tsx`

**Step 1: Write the failing test**

- Add a test that dragging one selected node while multiple nodes are selected moves all selected nodes together.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: FAIL because drag currently moves only one node.

**Step 3: Write minimal implementation**

- Extend drag state to include a selected set and per-node offsets.
- Apply pending position updates to all selected nodes during drag.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: PASS

### Task 3: Add failing tests for canvas pan with Space+drag

**Files:**

- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.tsx`

**Step 1: Write the failing test**

- Add a test that `Space`+drag changes the canvas viewport offset without changing node coordinates.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: FAIL because there is no pan behavior.

**Step 3: Write minimal implementation**

- Add viewport offset state.
- Render the node/link layer inside a translated `<g>`.
- Handle `Space` key state and panning drag.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: PASS

### Task 4: Add failing tests for edge-anchored cable labels

**Files:**

- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.tsx`

**Step 1: Write the failing test**

- Add assertions that label pills are positioned outside node bounds for both horizontal and vertical links.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: FAIL until edge-anchor math is corrected.

**Step 3: Write minimal implementation**

- Compute anchor points from node rectangle edges instead of centers.
- Apply directional offsets for horizontal and vertical links.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: PASS

### Task 5: Final verification

**Files:**

- Modify: none expected

**Step 1: Run focused canvas tests**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx`
Expected: PASS

**Step 2: Run focused app tests**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: PASS

**Step 3: Run web build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
