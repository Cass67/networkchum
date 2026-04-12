# Native Telnet Double-Click Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Open the OS default `telnet://` handler on node double-click while keeping the existing web console, and surface the telnet port in the UI.

**Architecture:** Reuse existing runtime state and `nodeConnectCommands` data already loaded into the web app. Add a small UI-only enhancement: detect double-click on telnet-backed nodes in the canvas, open `telnet://127.0.0.1:<port>`, and show the port in the sidebar/selection details.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

---

### Task 1: Add failing UI tests for native telnet open

**Files:**

- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Step 1: Write the failing tests**

- Add a `TopologyCanvas` test that double-clicks a node and expects a callback for native telnet open when the node has a telnet-backed runtime state.
- Add an `App` test that spies on `window.open`, double-clicks a telnet-backed node, and expects `window.open('telnet://127.0.0.1:5004', '_self')`.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: FAIL because no double-click native telnet behavior exists.

**Step 3: Write minimal implementation**

- Add an `onOpenNativeConsole` callback to `TopologyCanvas`.
- Trigger it on node double-click when the node has a telnet connect command.
- In `App`, translate the existing `nodeConnectCommands[nodeId]` into a `telnet://127.0.0.1:<port>` URL and call `window.open(url, '_self')`.

**Step 4: Run tests to verify they pass**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: PASS

### Task 2: Add failing UI tests for telnet port visibility

**Files:**

- Modify: `apps/web/src/components/SelectionPanel.test.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Step 1: Write the failing tests**

- Add a `SelectionPanel` test expecting a telnet port label when a selected node has a telnet-backed console command.
- Add an `App` test that loads a running Arista node with `['telnet', '127.0.0.1', '5004']` and expects `Telnet Port: 5004` in the sidebar.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/SelectionPanel.test.tsx src/App.test.tsx`
Expected: FAIL because no telnet port is rendered.

**Step 3: Write minimal implementation**

- Extend `SelectionPanel` node selection data with an optional `connectCommand`.
- Parse the third element of a telnet command as the port and render `Telnet Port: <port>`.

**Step 4: Run tests to verify they pass**

Run: `npm exec --workspace @networkchum/web vitest run src/components/SelectionPanel.test.tsx src/App.test.tsx`
Expected: PASS

### Task 3: Full verification

**Files:**

- Modify: none expected

**Step 1: Run focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/components/SelectionPanel.test.tsx src/App.test.tsx`
Expected: PASS

**Step 2: Run web build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
