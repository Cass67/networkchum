# Native Console Preference Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a first-class global native console preference with `Web Console`, `Copy Native Command`, and `Open in iTerm`, while preserving busy-console safeguards.

**Architecture:** Store the preference in `localStorage` alongside existing app-level preferences and route node double-click behavior through that preference. For `Open in iTerm`, generate a custom helper URL for a separate macOS helper; keep `Copy Native Command` and web console as supported fallbacks.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, localStorage

---

### Task 1: Add failing tests for preference rendering and persistence

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write the failing test**

- Add an app test that expects a `Native Console Preference` control to render.
- Add a test that changes the preference to `Open in iTerm`, remounts the app, and expects the selection to persist from `localStorage`.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: FAIL because no native console preference exists.

**Step 3: Write minimal implementation**

- Add a new app-level preference state in `App.tsx`.
- Persist it in `localStorage` using a dedicated key.
- Render a simple selector with the three options.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: PASS

### Task 2: Add failing tests for preference-driven double-click behavior

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write the failing test**

- Add a test for `Web Console` preference: double-click opens the web console.
- Add a test for `Copy Native Command` preference: double-click copies `/usr/local/bin/telnet 127.0.0.1 5004`.
- Add a test for `Open in iTerm` preference: double-click calls `window.open('networkchum://open-console?terminal=iterm&host=127.0.0.1&port=5004', '_self')`.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: FAIL because double-click still always uses the current telnet URL path.

**Step 3: Write minimal implementation**

- Add a small preference-aware native launch router in `App.tsx`.
- Route double-click behavior based on the selected preference.
- Keep `Open Console` button mapped to web console only.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/App.test.tsx`
Expected: PASS

### Task 3: Add failing tests for helper URL and fallback command visibility

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/LabDetails.test.tsx`
- Modify: `apps/web/src/components/LabDetails.tsx`

**Step 1: Write the failing test**

- Add a test that expects the runtime panel to show the currently effective native action for telnet-backed nodes.
- Keep the existing `Copy Native Command` button visible regardless of preference.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabDetails.test.tsx src/App.test.tsx`
Expected: FAIL because no preference-aware native action label is shown.

**Step 3: Write minimal implementation**

- Add small UI copy indicating the selected native-console mode.
- Keep telnet port and copy-command button visible.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabDetails.test.tsx src/App.test.tsx`
Expected: PASS

### Task 4: Verify focused web behavior

**Files:**

- Modify: none expected

**Step 1: Run focused tests**

Run: `npm exec --workspace @networkchum/web vitest run src/components/TopologyCanvas.test.tsx src/components/LabDetails.test.tsx src/App.test.tsx`
Expected: PASS

**Step 2: Run build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
