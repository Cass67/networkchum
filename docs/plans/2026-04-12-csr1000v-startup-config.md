# CSR1000v Startup Config Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make CSR1000v nodes boot with an injected startup config when node config text exists, without attaching any config artifact when no config text is present.

**Architecture:** Keep the existing lab startup-config model and refactor only the API runtime boot path. Introduce a CSR1000v-specific injector helper that owns artifact creation and exact QEMU attachment args, then update `powerOnNode()` and tests to use that helper.

**Tech Stack:** TypeScript, Fastify API runtime, Vitest, QEMU command construction

---

### Task 1: Add CSR1000v injector abstraction

**Files:**

- Modify: `apps/api/src/runtime/configInjectors.ts`
- Test: `apps/api/src/runtime/powerNode.test.ts`

**Step 1: Write the failing test**

Add a focused `powerOnNode()` test that powers on a `cisco-asr` node with an active startup config set and asserts the generated `commandPreview` includes the CSR config-drive args.

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @networkchum/api -- powerNode.test.ts`

Expected: FAIL because there is no stable assertion point yet for the CSR-specific config-drive output.

**Step 3: Write minimal implementation**

Refactor the CSR injector code in `apps/api/src/runtime/configInjectors.ts` to expose a helper that:

- accepts config text and output path
- creates the FAT image payload with `iosxe_config.txt`
- returns named metadata plus exact QEMU args for the chosen CSR layout

Keep the initial layout equivalent to the current behavior so this is a structural improvement first, not a speculative behavior change.

**Step 4: Run test to verify it passes**

Run: `npm run test --workspace @networkchum/api -- powerNode.test.ts`

Expected: PASS with the CSR command preview showing the config-drive args.

**Step 5: Commit**

```bash
git add apps/api/src/runtime/configInjectors.ts apps/api/src/runtime/powerNode.test.ts
git commit -m "refactor: isolate csr1000v startup config injector"
```

### Task 2: Switch `powerOnNode()` to the CSR helper

**Files:**

- Modify: `apps/api/src/runtime/powerNode.ts`
- Test: `apps/api/src/runtime/powerNode.test.ts`

**Step 1: Write the failing test**

Add a test that powers on a `cisco-asr` node with no config entry in the active set and asserts no CSR config-drive args are attached.

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @networkchum/api -- powerNode.test.ts`

Expected: FAIL if the current test fixture does not clearly distinguish the no-config case.

**Step 3: Write minimal implementation**

Update `apps/api/src/runtime/powerNode.ts` to:

- call the new CSR helper when `configInjectMethod === "csr1000v-vfat"`
- keep injection gated on `startupConfig !== undefined`
- log the selected CSR layout and artifact path
- continue passing the returned QEMU args through `extraArgs`

Do not change the shared topology schema or route API.

**Step 4: Run test to verify it passes**

Run: `npm run test --workspace @networkchum/api -- powerNode.test.ts`

Expected: PASS for both the config-present and no-config cases.

**Step 5: Commit**

```bash
git add apps/api/src/runtime/powerNode.ts apps/api/src/runtime/powerNode.test.ts
git commit -m "fix: route csr1000v startup config through explicit injector"
```

### Task 3: Add runtime diagnostics for CSR launch debugging

**Files:**

- Modify: `apps/api/src/runtime/powerNode.ts`
- Test: `apps/api/src/runtime/powerNode.test.ts`

**Step 1: Write the failing test**

Add a test that verifies the runtime state `commandPreview` preserves the CSR config-drive attachment args for a node with startup config.

**Step 2: Run test to verify it fails**

Run: `npm run test --workspace @networkchum/api -- powerNode.test.ts`

Expected: FAIL if the command preview does not include the final injected args in a stable way.

**Step 3: Write minimal implementation**

Ensure `powerOnNode()` logs and persists the exact QEMU command preview, including CSR config-drive args, without altering unrelated runtime behavior.

**Step 4: Run test to verify it passes**

Run: `npm run test --workspace @networkchum/api -- powerNode.test.ts`

Expected: PASS with preserved CSR attachment visibility in runtime state.

**Step 5: Commit**

```bash
git add apps/api/src/runtime/powerNode.ts apps/api/src/runtime/powerNode.test.ts
git commit -m "test: preserve csr1000v command preview diagnostics"
```

### Task 4: Verify API tests and build

**Files:**

- Modify: none unless verification reveals a real issue

**Step 1: Run targeted API tests**

Run: `npm run test --workspace @networkchum/api -- powerNode.test.ts`

Expected: PASS

**Step 2: Run full API test suite**

Run: `npm run test --workspace @networkchum/api`

Expected: PASS

**Step 3: Run API build**

Run: `npm run build --workspace @networkchum/api`

Expected: PASS

**Step 4: Commit verification-safe changes if needed**

Only commit if verification required a real code change.

### Task 5: Manual CSR1000v validation

**Files:**

- Modify: none unless manual validation reveals a real bug

**Step 1: Start the API and power on a CSR1000v node with config**

Run: `npm run dev:api`

Expected: API starts cleanly and logs CSR injector details during node power-on.

**Step 2: Verify first-boot behavior in the console**

Expected: CSR1000v consumes the startup config instead of falling into ZTP.

**Step 3: Verify the empty-config case**

Expected: with no node config entry, no CSR startup-config artifact is attached.

**Step 4: If CSR still falls into ZTP, capture the exact command preview**

Use the saved runtime state and logs to identify whether the next experiment should change disk bus, filename, or media type.
