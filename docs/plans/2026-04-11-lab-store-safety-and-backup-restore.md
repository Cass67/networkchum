# Lab Store Safety And Backup Restore Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `labs.json` writes safe and add lab-scoped backup listing/restoration from the lab context menu.

**Architecture:** First harden `labStore` with atomic temp-file writes and an in-process write queue. Then add backup list/restore API endpoints and wire them into the lab browser context menu and dialogs.

**Tech Stack:** Fastify, TypeScript, React, Vitest, Testing Library, Node fs/promises

---

### Task 1: Add failing API tests for atomic/serialized lab-store writes

**Files:**

- Modify: `apps/api/src/labs/labStore.ts`
- Modify: `apps/api/src/app.test.ts`

**Step 1: Write the failing test**

- Add a test that simulates overlapping lab updates and verifies `labs.json` remains valid JSON and contains the latest write.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: FAIL because writes are currently direct and unqueued.

**Step 3: Write minimal implementation**

- Add a simple module-level write queue/mutex.
- Write to a temp file, then rename atomically.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

### Task 2: Add failing API tests for listing and restoring backups

**Files:**

- Modify: `apps/api/src/labs/labBackupStore.ts`
- Modify: `apps/api/src/routes/labs.ts`
- Modify: `apps/api/src/app.test.ts`

**Step 1: Write the failing test**

- Add a test for `GET /labs/:labId/backups` returning timestamped backup entries.
- Add a test for `POST /labs/:labId/restore-backup` restoring the selected snapshot into the lab record.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: FAIL because the endpoints do not exist.

**Step 3: Write minimal implementation**

- Add backup listing helper.
- Add restore helper that reads a selected snapshot and replaces that lab record.
- Add the two routes.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

### Task 3: Add failing web tests for lab context-menu backup actions

**Files:**

- Modify: `apps/web/src/components/LabBrowser.tsx`
- Modify: `apps/web/src/components/LabBrowser.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Step 1: Write the failing test**

- Add a test that lab right-click shows `List Backups`.
- Add an `App` test that choosing the action opens a backup list dialog and can trigger restore confirmation.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabBrowser.test.tsx src/App.test.tsx`
Expected: FAIL because no backup actions/dialogs exist.

**Step 3: Write minimal implementation**

- Add backup list/restore API client methods.
- Add lab context-menu actions.
- Add a simple backup list dialog with restore confirmation.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabBrowser.test.tsx src/App.test.tsx`
Expected: PASS

### Task 4: Final verification

**Files:**

- Modify: docs if needed

**Step 1: Run API tests**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

**Step 2: Run focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabBrowser.test.tsx src/App.test.tsx`
Expected: PASS

**Step 3: Run builds**

Run: `npm run build --workspace @networkchum/api && npm run build --workspace @networkchum/web`
Expected: PASS
