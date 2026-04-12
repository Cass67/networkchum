# Bind Mode And Start Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a simple runtime switch that keeps NetworkChum on localhost by default, supports LAN access when requested, and provides a root start script to launch either mode.

**Architecture:** Keep the internal VM and QEMU socket traffic on loopback, but make the user-facing API and web server switchable between loopback and LAN binds. Move browser-side API and console URLs off hardcoded `127.0.0.1` values so they follow the page host, and add a shell wrapper that sets the bind mode and prints the right access URL.

**Tech Stack:** TypeScript, React, Vite, Fastify, shell scripting, Vitest, Node test runner

---

### Task 1: Plan The Bind-Mode Surface

**Files:**

- Create: `docs/superpowers/plans/2026-04-12-bind-mode-lan-start-script.md`
- Modify: `package.json`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/NodeConsole.tsx`
- Create: `apps/web/src/runtimeUrls.ts`
- Test: `packages/shared/src/networkAccess.test.ts`
- Test: `apps/web/src/runtimeUrls.test.ts`
- Test: `scripts/start.test.mjs`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run the targeted tests and confirm they fail for missing bind-mode support**
- [ ] **Step 3: Implement the smallest bind-mode helper and browser URL helper**
- [ ] **Step 4: Re-run the targeted tests and confirm they pass**

### Task 2: Wire The Runtime Hosts

**Files:**

- Create: `packages/shared/src/networkAccess.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/NodeConsole.tsx`

- [ ] **Step 1: Use the shared helper in the API listen host**
- [ ] **Step 2: Use the shared helper in the Vite host**
- [ ] **Step 3: Replace hardcoded browser API and websocket hosts with helper-driven URLs**
- [ ] **Step 4: Keep native bridge behavior local-only from the browser when the page host is remote**
- [ ] **Step 5: Run focused tests for the new helpers**

### Task 3: Add The Start Script

**Files:**

- Create: `start.sh`
- Modify: `package.json`
- Test: `scripts/start.test.mjs`

- [ ] **Step 1: Write a failing start-script test for `localhost` and `lan` modes**
- [ ] **Step 2: Implement the minimal `start.sh` wrapper**
- [ ] **Step 3: Add a package script entry if it improves discoverability**
- [ ] **Step 4: Re-run the start-script test**

### Task 4: Document And Verify

**Files:**

- Modify: `INSTALL.md`

- [ ] **Step 1: Document the bind-mode option and the new start script**
- [ ] **Step 2: Run targeted tests**
- [ ] **Step 3: Run repo checks for the touched files**
- [ ] **Step 4: Summarize any residual limitations, especially around native console bridge use from remote browsers**
