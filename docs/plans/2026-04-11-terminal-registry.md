# Terminal Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the native-console mode to `Open in Terminal` and add a first-class terminal registry with built-in and user-defined terminal entries.

**Architecture:** Keep the existing localhost bridge and web preference flow, but replace the fixed macOS terminal dropdown with a persisted registry of terminal entries. Built-ins stay structured while custom entries store a user-defined command template using `{host}` and `{port}` placeholders.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Node.js

---

### Task 1: Add failing web tests for label rename and terminal registry UI

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write the failing test**

- Update tests to expect `Open in Terminal` instead of `Open in iTerm`.
- Add a test that the terminal selector includes built-ins and an `Add Terminal...` option.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: FAIL because the old labels and fixed dropdown are still present.

**Step 3: Write minimal implementation**

- Rename the mode label.
- Replace the fixed selector with a registry-backed selector.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: PASS

### Task 2: Add failing web tests for add-terminal flow and persistence

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write the failing test**

- Add a test that selecting `Add Terminal...` opens a small form/dialog.
- Add a test that saving `Ghostty` with template `ghostty -e /usr/local/bin/telnet {host} {port}` adds it to the selector immediately and persists it across remounts.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: FAIL because custom terminals are not supported yet.

**Step 3: Write minimal implementation**

- Add dialog/form state for terminal creation.
- Persist the registry in `localStorage`.
- Add the saved entry to the selector list.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: PASS

### Task 3: Add failing bridge tests for custom template expansion

**Files:**

- Modify: `tools/native-console-bridge/server.test.js`
- Modify: `tools/native-console-bridge/server.js`

**Step 1: Write the failing test**

- Add a bridge test that a custom terminal payload expands `{host}` and `{port}` correctly.
- Add a test for malformed template rejection if placeholders are missing or invalid.

**Step 2: Run test to verify it fails**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: FAIL because the bridge only supports built-in terminal values today.

**Step 3: Write minimal implementation**

- Extend the bridge payload to support custom template launches.
- Expand placeholders safely.

**Step 4: Run test to verify it passes**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: PASS

### Task 4: Final verification

**Files:**

- Modify: `tools/native-console-bridge/README.md` if needed to document custom terminals

**Step 1: Run bridge tests**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: PASS

**Step 2: Run focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx src/components/LabDetails.test.tsx`
Expected: PASS

**Step 3: Run web build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
