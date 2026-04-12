# Lab Auto Backup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a per-lab `Auto Backup` toggle that writes timestamped JSON backups after successful lab mutations, keeping the newest 10 snapshots.

**Architecture:** Store the auto-backup preference with each lab record, add a small backup service under the API layer, and call it after successful mutation writes. Surface the toggle in the lab inspector and keep backup failures non-fatal.

**Tech Stack:** Fastify, TypeScript, React, Vitest, Testing Library, Node fs/promises

---

### Task 1: Add failing API tests for backup writing and retention

**Files:**

- Modify: `apps/api/src/app.test.ts`
- Create: `apps/api/src/labs/labBackupStore.ts`
- Modify: `apps/api/src/labs/labStore.ts`

**Step 1: Write the failing test**

- Add an API test showing that when a lab has auto-backup enabled, a successful mutation writes a timestamped backup file.
- Add a retention test showing only the newest 10 backups are kept.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: FAIL because no backup mechanism exists.

**Step 3: Write minimal implementation**

- Add a backup store/service under `apps/api/src/labs/`.
- Write snapshots to `apps/api/data/lab-backups/<lab-id>/`.
- Trim older files beyond 10.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

### Task 2: Add failing API tests for per-lab auto-backup toggle

**Files:**

- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/routes/labs.ts`
- Modify: `apps/api/src/labs/labStore.ts`

**Step 1: Write the failing test**

- Add a test that a lab can toggle `autoBackup` on and off.
- Add a test that when disabled, mutations do not write backups.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: FAIL because the lab record has no auto-backup setting yet.

**Step 3: Write minimal implementation**

- Extend lab record shape with `autoBackup`.
- Add a route to update the flag.
- Thread the flag through list/get responses.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

### Task 3: Add failing web tests for lab inspector auto-backup toggle

**Files:**

- Modify: `apps/web/src/components/SelectionPanel.tsx`
- Modify: `apps/web/src/components/SelectionPanel.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

**Step 1: Write the failing test**

- Add a `SelectionPanel` test for an `Auto Backup` checkbox on a selected lab.
- Add an `App` test that toggling the checkbox calls the backend and updates the selected lab state.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/SelectionPanel.test.tsx src/App.test.tsx`
Expected: FAIL because no checkbox exists yet.

**Step 3: Write minimal implementation**

- Render the checkbox in the lab card.
- Add an app handler to call the new API route and update selected lab state.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/SelectionPanel.test.tsx src/App.test.tsx`
Expected: PASS

### Task 4: Final verification

**Files:**

- Modify: none expected

**Step 1: Run API tests**

Run: `npm exec --workspace @networkchum/api vitest run src/app.test.ts`
Expected: PASS

**Step 2: Run focused web tests**

Run: `npm exec --workspace @networkchum/web vitest run src/components/SelectionPanel.test.tsx src/App.test.tsx`
Expected: PASS

**Step 3: Run builds**

Run: `npm run build --workspace @networkchum/api && npm run build --workspace @networkchum/web`
Expected: PASS
