# Native Console Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a localhost bridge that lets the web app open native telnet consoles in `iTerm` reliably.

**Architecture:** Create a small local bridge service under `tools/` that binds to `127.0.0.1`, validates structured requests, and launches `iTerm` with the telnet command. Update the web app’s `Open in iTerm` preference path to call the bridge instead of any URL scheme, with fallback UI behavior if the bridge is unavailable.

**Tech Stack:** Node.js, TypeScript or JavaScript, React, Vitest, Testing Library, shell scripts

---

### Task 1: Add failing tests for bridge-aware web behavior

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write the failing test**

- Update the `Open in iTerm` test so double-click expects a `fetch()` call to `http://127.0.0.1:<bridge-port>/open-console` instead of `window.open(...)`.
- Add a fallback test for bridge failure that keeps `Copy Native Command` available and records an error message.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: FAIL because the app still uses URL-based launch.

**Step 3: Write minimal implementation**

- Add a small `fetch()`-based native bridge call in `App.tsx`.
- Keep `Web Console` and `Copy Native Command` unchanged.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: PASS

### Task 2: Add failing bridge service tests

**Files:**

- Create: `tools/native-console-bridge/server.js`
- Create: `tools/native-console-bridge/server.test.js`
- Create: `scripts/run-native-console-bridge.sh`

**Step 1: Write the failing test**

- Add tests for:
  - accepts only `terminal: "iterm"`
  - accepts only localhost hosts
  - accepts valid ports only
  - returns success on a dry-run launch path
  - rejects malformed payloads

**Step 2: Run test to verify it fails**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: FAIL because the bridge does not exist.

**Step 3: Write minimal implementation**

- Add a tiny localhost HTTP server.
- Bind to `127.0.0.1` only.
- Support `POST /open-console`.
- Validate payload and construct `/usr/local/bin/telnet 127.0.0.1 <port>`.
- In dry-run mode, skip actual launch and return the command.
- In normal mode, launch `iTerm` with `osascript` or a direct supported mechanism.

**Step 4: Run test to verify it passes**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: PASS

### Task 3: Add install/run docs for the bridge

**Files:**

- Create: `tools/native-console-bridge/README.md`

**Step 1: Write the failing verification expectation**

- Define the exact docs needed:
  - how to start the bridge
  - how to verify it locally with `curl`
  - how the browser app behaves when it is unavailable

**Step 2: Verify docs are missing**

Run: `test -f tools/native-console-bridge/README.md`
Expected: FAIL

**Step 3: Write minimal implementation**

- Document start, stop, and test commands.
- Include a sample `curl` POST.
- Include a note that `Copy Native Command` remains the fallback.

**Step 4: Verify docs exist**

Run: `test -f tools/native-console-bridge/README.md`
Expected: PASS

### Task 4: Final verification

**Files:**

- Modify: none expected

**Step 1: Run focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx src/components/LabDetails.test.tsx`
Expected: PASS

**Step 2: Run bridge tests**

Run: `node --test tools/native-console-bridge/server.test.js`
Expected: PASS

**Step 3: Run web build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
