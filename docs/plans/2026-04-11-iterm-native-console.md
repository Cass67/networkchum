# iTerm Native Console Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Open a running telnet-backed node in `iTerm.app` on macOS while keeping the existing web console and telnet-port UI intact.

**Architecture:** Add a small frontend-native-launch path that prefers iTerm on macOS instead of relying on the broken system `telnet://` handler. Keep the current web console path unchanged and provide a fallback native command string when direct native launch is unavailable.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

---

### Task 1: Add failing tests for iTerm-specific native launch

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`

**Step 1: Write the failing test**

- Replace the current `telnet://...` double-click expectation with an iTerm-specific native launch expectation.
- Add a focused assertion that the native launch helper receives `host=127.0.0.1`, `port=5004`, and `terminal=iTerm`.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: FAIL because the app still uses `window.open('telnet://...')`.

**Step 3: Write minimal implementation**

- Add a small app-level helper to build the native telnet command for iTerm.
- Switch node double-click from `telnet://...` to the new helper.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: PASS

### Task 2: Add fallback command visibility tests

**Files:**

- Modify: `apps/web/src/components/LabDetails.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Step 1: Write the failing test**

- Add an assertion that the runtime sidebar shows a native fallback command for telnet-backed nodes, using `/usr/local/bin/telnet 127.0.0.1 5004`.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: FAIL because only the telnet port is shown.

**Step 3: Write minimal implementation**

- Show a native command string in the runtime panel for telnet-backed nodes.
- Keep the existing telnet port display.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: PASS

### Task 3: Verify focused web behavior

**Files:**

- Modify: none expected

**Step 1: Run focused tests**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/components/SelectionPanel.test.tsx src/App.test.tsx`
Expected: PASS

**Step 2: Run build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
