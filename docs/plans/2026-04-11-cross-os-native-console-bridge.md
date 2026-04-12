# Cross-OS Native Console Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Start the native console bridge with app startup and make the bridge choose the correct terminal launcher on macOS and Linux.

**Architecture:** Keep the browser-side bridge contract stable and extend the bridge with OS-specific launcher adapters. Update local dev startup so the bridge comes up automatically with the app. Preserve `Copy Native Command` and web-console fallbacks.

**Tech Stack:** Node.js, shell scripts, React, Vitest, Testing Library

---

### Task 1: Add failing tests for OS-specific launcher selection

**Files:**

- Modify: `tools/native-console-bridge/server.test.js`
- Modify: `tools/native-console-bridge/server.js`

**Step 1: Write the failing test**

- Add bridge tests for launcher selection:
  - macOS selects the macOS launcher path
  - Linux selects an available terminal from a priority list
  - unsupported OS returns a clear error

**Step 2: Run test to verify it fails**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: FAIL because the bridge only knows the current iTerm-specific path.

**Step 3: Write minimal implementation**

- Add an OS-aware launcher selection function.
- Keep request validation unchanged.
- Allow injected dependencies in tests to simulate available launchers.

**Step 4: Run test to verify it passes**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: PASS

### Task 2: Add failing tests for startup integration

**Files:**

- Modify: `package.json`
- Modify: `scripts/run-native-console-bridge.sh`

**Step 1: Write the failing verification expectation**

- Define the startup contract:
  - `npm run dev` starts API, web, and bridge together
  - bridge script remains runnable standalone

**Step 2: Verify current startup is incomplete**

Run: `Read package.json`
Expected: `dev` only starts API and web today.

**Step 3: Write minimal implementation**

- Add bridge startup to the root `dev` script.
- Keep a dedicated bridge script entry for standalone use.

**Step 4: Verify startup wiring**

Run: `Read package.json`
Expected: `dev` includes the bridge process.

### Task 3: Add/update docs for cross-OS behavior

**Files:**

- Modify: `tools/native-console-bridge/README.md`

**Step 1: Write the failing verification expectation**

- Docs should explain:
  - bridge starts automatically in dev
  - macOS behavior
  - Linux behavior and terminal detection
  - fallback when no terminal launcher is found

**Step 2: Verify docs are missing this scope**

Run: `Read tools/native-console-bridge/README.md`
Expected: docs only describe the current narrow bridge behavior.

**Step 3: Write minimal implementation**

- Update the README with startup, OS behavior, and troubleshooting.

**Step 4: Verify docs completeness**

Run: `Read tools/native-console-bridge/README.md`
Expected: clear cross-OS startup and fallback guidance.

### Task 4: Final verification

**Files:**

- Modify: none expected

**Step 1: Run bridge tests**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: PASS

**Step 2: Run focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx src/components/LabDetails.test.tsx`
Expected: PASS

**Step 3: Run web build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
