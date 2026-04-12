# Native Console UI Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add bridge health visibility, macOS terminal selection, and inline native-launch error handling to the existing native console workflow.

**Architecture:** Keep the current localhost bridge contract and extend it with a health endpoint plus terminal-selection support. Update the web app to store an OS-specific terminal preference, poll bridge health, and show bridge/native-launch status in the UI.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Node.js

---

### Task 1: Add failing bridge tests for health and terminal selection

**Files:**

- Modify: `tools/native-console-bridge/server.test.js`
- Modify: `tools/native-console-bridge/server.js`

**Step 1: Write the failing test**

- Add a test for `GET /health` returning `{ ok: true }`.
- Add a test for `POST /open-console` accepting `terminal: 'terminal-app'` on macOS and rejecting unsupported values.

**Step 2: Run test to verify it fails**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: FAIL because `/health` and terminal-app selection are not implemented.

**Step 3: Write minimal implementation**

- Add `GET /health`.
- Extend bridge validation/launcher logic for `terminal-app` on macOS.

**Step 4: Run test to verify it passes**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: PASS

### Task 2: Add failing web tests for bridge health and terminal preference persistence

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write the failing test**

- Add a test that bridge health is shown as `Online` when the health request succeeds.
- Add a test that the macOS terminal selection persists across remounts.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: FAIL because no bridge health indicator or terminal preference exists.

**Step 3: Write minimal implementation**

- Add bridge health state + fetch.
- Add terminal preference state/persistence.
- Render the new UI.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: PASS

### Task 3: Add failing web tests for inline bridge-down / launch-failure messaging

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/LabDetails.test.tsx`
- Modify: `apps/web/src/components/LabDetails.tsx`

**Step 1: Write the failing test**

- Add a test that a failed native bridge request shows a readable inline error.
- Add a test that the runtime panel shows `Bridge: Offline` or equivalent when health fails.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx src/components/LabDetails.test.tsx`
Expected: FAIL because the app currently has no inline native-launch error or bridge status copy.

**Step 3: Write minimal implementation**

- Add inline error state for native-launch failures.
- Thread bridge status and effective double-click action text into `LabDetails`.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx src/components/LabDetails.test.tsx`
Expected: PASS

### Task 4: Final verification

**Files:**

- Modify: `tools/native-console-bridge/README.md` if needed for any new API/terminal choices

**Step 1: Run bridge tests**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: PASS

**Step 2: Run focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx src/components/LabDetails.test.tsx`
Expected: PASS

**Step 3: Run web build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
