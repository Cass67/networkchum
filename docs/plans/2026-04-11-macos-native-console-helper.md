# macOS Native Console Helper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a local macOS helper that registers `networkchum://open-console` and launches `iTerm.app` with `/usr/local/bin/telnet 127.0.0.1 <port>`.

**Architecture:** Keep the browser app unchanged except for the already-added helper URL generation. Add a small installable macOS helper app source and an installer script inside the repo. The installer compiles/copies the helper into `~/Applications`, registers the custom URL scheme, and the helper parses the incoming URL, validates host/port, and launches iTerm through AppleScript.

**Tech Stack:** shell script, AppleScript, macOS app bundle metadata, repo docs

---

### Task 1: Add failing tests for helper install artifacts

**Files:**

- Create: `tools/native-console-helper/README.md`
- Create: `scripts/install-networkchum-native-console-helper.sh`
- Create: `tools/native-console-helper/NetworkChumConsoleHelper.app/Contents/Info.plist`
- Test: `apps/web/src/App.test.tsx`

**Step 1: Write the failing test**

- Add an app-level test/assertion or documentation test expectation that references the exact helper URL scheme already emitted by the web app and documents the install path.
- Add file-level existence and content validation via a focused shell verification step.

**Step 2: Run test to verify it fails**

Run: `test -f tools/native-console-helper/NetworkChumConsoleHelper.app/Contents/Info.plist && test -f scripts/install-networkchum-native-console-helper.sh`
Expected: FAIL because helper files do not exist.

**Step 3: Write minimal implementation**

- Add `Info.plist` with `CFBundleURLTypes` for `networkchum`.
- Add installer script that copies the helper app to `~/Applications` and registers it.
- Add README with exact install/verify commands.

**Step 4: Run verification**

Run: `test -f tools/native-console-helper/NetworkChumConsoleHelper.app/Contents/Info.plist && test -f scripts/install-networkchum-native-console-helper.sh`
Expected: PASS

### Task 2: Add failing tests for helper URL parsing and iTerm launch script

**Files:**

- Create: `tools/native-console-helper/NetworkChumConsoleHelper.app/Contents/MacOS/networkchum-console-helper`
- Create: `tools/native-console-helper/networkchum-helper-smoke.sh`

**Step 1: Write the failing test**

- Add a shell smoke script that invokes the helper executable with a sample URL argument and expects it to parse `terminal=iterm`, `host=127.0.0.1`, and `port=5004`.
- The smoke script should support a dry-run mode so it does not actually launch iTerm during tests.

**Step 2: Run test to verify it fails**

Run: `sh tools/native-console-helper/networkchum-helper-smoke.sh`
Expected: FAIL because the helper executable does not exist yet.

**Step 3: Write minimal implementation**

- Add an executable helper script inside the app bundle.
- Validate scheme/path/query.
- Build the telnet command `/usr/local/bin/telnet 127.0.0.1 5004`.
- In normal mode, call `osascript` to launch `iTerm.app` and run the command.
- In dry-run mode, print the parsed values and command instead.

**Step 4: Run test to verify it passes**

Run: `sh tools/native-console-helper/networkchum-helper-smoke.sh`
Expected: PASS

### Task 3: Add install and verification docs

**Files:**

- Modify: `tools/native-console-helper/README.md`

**Step 1: Write the failing verification expectation**

- Document a concrete end-to-end manual verification path:
  1. install helper
  2. run `open 'networkchum://open-console?terminal=iterm&host=127.0.0.1&port=5004'`
  3. confirm iTerm launches telnet

**Step 2: Run verification script and inspect docs**

Run: `Read tools/native-console-helper/README.md`
Expected: Incomplete instructions before implementation.

**Step 3: Write minimal implementation**

- Add exact install, reinstall, unregister, and verification commands.
- Include the fallback note that `Copy Native Command` remains supported.

**Step 4: Verify docs completeness**

Run: `Read tools/native-console-helper/README.md`
Expected: Clear, complete local install instructions.

### Task 4: Final verification

**Files:**

- Modify: none expected

**Step 1: Run focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: PASS

**Step 2: Run helper smoke verification**

Run: `sh tools/native-console-helper/networkchum-helper-smoke.sh`
Expected: PASS

**Step 3: Run web build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
