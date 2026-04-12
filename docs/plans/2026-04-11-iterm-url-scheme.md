# iTerm URL Scheme Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the custom helper-based `Open in iTerm` path with iTerm's native URL scheme directly from the web app.

**Architecture:** Keep the existing native console preference UI but change the `iterm-helper` mode semantics to a direct iTerm URL launch. Remove helper-specific assumptions from the app flow while preserving `Web Console`, `Copy Native Command`, and busy-console safeguards.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

---

### Task 1: Add failing tests for direct iTerm URL generation

**Files:**

- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Step 1: Write the failing test**

- Update the `Open in iTerm` test to expect the iTerm-native URL scheme instead of `networkchum://...`.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: FAIL because the app still generates `networkchum://open-console?...`.

**Step 3: Write minimal implementation**

- Replace helper URL generation with a direct iTerm URL builder.
- Keep the preference name and UI label unchanged for now.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx`
Expected: PASS

### Task 2: Remove helper-specific UI copy from the app flow

**Files:**

- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/LabDetails.tsx`
- Modify: `apps/web/src/components/LabDetails.test.tsx`

**Step 1: Write the failing test**

- Add or update runtime panel assertions so the displayed double-click action text remains `Open in iTerm` and does not mention a helper.

**Step 2: Run test to verify it fails**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabDetails.test.tsx src/App.test.tsx`
Expected: FAIL if helper-specific assumptions remain.

**Step 3: Write minimal implementation**

- Ensure the runtime panel reflects the preference label only.
- Do not show or depend on helper-specific language in the web UI.

**Step 4: Run test to verify it passes**

Run: `npm exec --workspace @networkchum/web vitest run src/components/LabDetails.test.tsx src/App.test.tsx`
Expected: PASS

### Task 3: Final verification

**Files:**

- Modify: none expected

**Step 1: Run focused tests**

Run: `npm exec --workspace @networkchum/web vitest run src/App.test.tsx src/components/LabDetails.test.tsx`
Expected: PASS

**Step 2: Run build**

Run: `npm run build --workspace @networkchum/web`
Expected: PASS
