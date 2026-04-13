# macOS Management Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a real macOS `management` cloud path that provides host-only static-IP management reachability, while preserving the existing Linux TAP/bridge behavior and removing the misleading Podman/Docker fallback for management clouds.

**Architecture:** Split cloud behavior by platform and role instead of routing all non-Linux cloud nodes through the current NAT-helper branch. Add explicit backend/capability reporting, teach QEMU command construction about a macOS management NIC mode, and surface the platform behavior in the UI so operators can see whether they are using Linux TAP, macOS host-only management, or generic socket fallback.

**Tech Stack:** TypeScript, Fastify, React, Vite, Vitest, QEMU networking, existing NetworkChum topology/runtime modules

---

## File Structure

### Existing Files To Modify

- `apps/api/src/runtime/hostCapabilities.ts`
  - Keep platform detection centralized.
  - Add explicit cloud-management capability reporting instead of forcing callers to infer behavior from `tap` vs `socket`.
- `apps/api/src/runtime/hostCapabilities.test.ts`
  - Lock down the new capability model with unit tests.
- `apps/api/src/routes/health.ts`
  - Return a richer health payload that includes networking/backend capability details for the UI.
- `apps/api/src/app.test.ts`
  - Verify the health endpoint returns the new capability payload.
- `apps/api/src/network/cloudUplink.ts`
  - Keep cloud-role resolution consistent with the new management behavior.
- `apps/api/src/runtime/powerNode.ts`
  - Split cloud power-on/off behavior by role and platform.
  - Remove the container/NAT helper path for macOS `management` clouds.
- `apps/api/src/runtime/powerNode.test.ts`
  - Add regression tests for macOS management clouds and keep Linux behavior covered.
- `apps/api/src/runtime/qemu/buildQemuCommand.ts`
  - Support per-NIC network backends so a node can use `socket` for normal links and a macOS host-only mode for management links.
- `apps/api/src/runtime/qemu/buildQemuCommand.test.ts`
  - Verify the exact QEMU args for the new NIC mode.
- `apps/web/src/App.tsx`
  - Load the richer health payload and pass the platform/backend details into cloud dialogs and the main shell.
- `apps/web/src/App.test.tsx`
  - Add coverage for backend-badge rendering and macOS management guidance flow.
- `apps/web/src/components/AddNodeDialog.tsx`
  - Show macOS management subnet guidance when the current API host reports macOS host-only management capability.
- `apps/web/src/components/AddNodeDialog.test.tsx`
  - Verify the macOS-specific helper text.
- `apps/web/src/components/CloudNodeSettingsDialog.tsx`
  - Show the fixed subnet/host IP guidance for management clouds on macOS.
- `apps/web/src/components/SelectionPanel.tsx`
  - Show the management subnet/host IP guidance for selected macOS management clouds.
- `apps/web/src/components/SelectionPanel.test.tsx`
  - Verify the inspector text and cloud-only messaging.
- `README.md`
  - Document the new macOS management-cloud behavior at a high level.
- `INSTALL.md`
  - Document operator setup and expectations for the global macOS management subnet.
- `docs/architecture.md`
  - Update the platform networking sections to describe Linux TAP vs macOS host-only management.

### New Files To Create

- `apps/api/src/runtime/macosManagementCloud.ts`
  - Own the macOS management-cloud constants and capability checks.
  - Export the fixed subnet/host-IP metadata and any availability probe helpers.
- `apps/api/src/runtime/macosManagementCloud.test.ts`
  - Unit-test capability/metadata behavior without coupling it to `powerNode.ts`.

## Implementation Notes

- The first implementation should keep the global subnet hardcoded:
  - subnet: `172.31.255.0/24`
  - host IP: `172.31.255.1`
- The plan assumes the macOS management NIC path is implemented through QEMU’s host-only networking support, exposed through `buildQemuCommand.ts` as a dedicated per-NIC backend mode.
- If the capability check determines the macOS host-only path is unavailable, fail with a clear operator-facing message instead of falling back to Podman or Docker.
- Do not add DHCP.
- Do not change Linux TAP behavior.

---

### Task 1: Add Explicit Backend Capability Reporting

**Files:**

- Modify: `apps/api/src/runtime/hostCapabilities.ts`
- Test: `apps/api/src/runtime/hostCapabilities.test.ts`
- Modify: `apps/api/src/routes/health.ts`
- Test: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write the failing capability tests**

Add tests in `apps/api/src/runtime/hostCapabilities.test.ts` that lock the new shape:

```ts
expect(getCloudManagementCapability("linux")).toEqual({
  platform: "linux",
  networkBackend: "tap",
  managementCloudMode: "linux-bridge",
});

expect(getCloudManagementCapability("macos")).toEqual({
  platform: "macos",
  networkBackend: "socket",
  managementCloudMode: "macos-host-only",
});
```

- [ ] **Step 2: Run the host capability test to verify it fails**

Run: `npm test --workspace @networkchum/api -- hostCapabilities.test.ts`

Expected: FAIL because `getCloudManagementCapability` does not exist yet.

- [ ] **Step 3: Implement the capability helper**

Add a small exported helper in `apps/api/src/runtime/hostCapabilities.ts`, for example:

```ts
export function getCloudManagementCapability(
  platform: "linux" | "macos" | "other" = getPlatform(),
) {
  if (platform === "linux") {
    return {
      platform,
      networkBackend: "tap" as const,
      managementCloudMode: "linux-bridge" as const,
    };
  }

  if (platform === "macos") {
    return {
      platform,
      networkBackend: "socket" as const,
      managementCloudMode: "macos-host-only" as const,
    };
  }

  return {
    platform,
    networkBackend: "socket" as const,
    managementCloudMode: "unsupported" as const,
  };
}
```

- [ ] **Step 4: Extend the health endpoint with the capability payload**

Update `apps/api/src/routes/health.ts` to return:

```ts
return {
  ok: true,
  capabilities: {
    cloudManagement: getCloudManagementCapability(),
  },
};
```

Add an `app.test.ts` assertion like:

```ts
expect(payload.capabilities.cloudManagement.managementCloudMode).toBeDefined();
```

- [ ] **Step 5: Run the focused API tests**

Run: `npm test --workspace @networkchum/api -- hostCapabilities.test.ts app.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/runtime/hostCapabilities.ts apps/api/src/runtime/hostCapabilities.test.ts apps/api/src/routes/health.ts apps/api/src/app.test.ts
git commit -m "feat: expose cloud management backend capability"
```

---

### Task 2: Introduce The macOS Management Cloud Capability Module

**Files:**

- Create: `apps/api/src/runtime/macosManagementCloud.ts`
- Test: `apps/api/src/runtime/macosManagementCloud.test.ts`

- [ ] **Step 1: Write the failing unit test for macOS management metadata**

Add tests like:

```ts
expect(getMacOsManagementSubnet()).toEqual({
  subnetCidr: "172.31.255.0/24",
  hostIp: "172.31.255.1",
});
```

and

```ts
expect(buildMacOsManagementUnavailableMessage()).toContain(
  "host-only management backend",
);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test --workspace @networkchum/api -- macosManagementCloud.test.ts`

Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Create the macOS management helper**

Implement a focused module such as:

```ts
export const MACOS_MANAGEMENT_SUBNET_CIDR = "172.31.255.0/24";
export const MACOS_MANAGEMENT_HOST_IP = "172.31.255.1";

export function getMacOsManagementSubnet() {
  return {
    subnetCidr: MACOS_MANAGEMENT_SUBNET_CIDR,
    hostIp: MACOS_MANAGEMENT_HOST_IP,
  };
}

export function buildMacOsManagementUnavailableMessage() {
  return "Management cloud on macOS requires the host-only management backend, but it is unavailable on this host.";
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test --workspace @networkchum/api -- macosManagementCloud.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/runtime/macosManagementCloud.ts apps/api/src/runtime/macosManagementCloud.test.ts
git commit -m "feat: add macos management cloud metadata module"
```

---

### Task 3: Teach QEMU Command Building About A macOS Management NIC Mode

**Files:**

- Modify: `apps/api/src/runtime/qemu/buildQemuCommand.ts`
- Test: `apps/api/src/runtime/qemu/buildQemuCommand.test.ts`

- [ ] **Step 1: Write the failing command-builder test**

Add a test that mixes socket and management NICs:

```ts
const result = buildQemuCommand({
  labId: "lab-1",
  nodeId: "node-1",
  imagePath: "/tmp/test.qcow2",
  machineType: "q35",
  config: { ramMb: 1024, vcpu: 1, interfaceCount: 2, nicModel: "e1000" },
  networkBackend: "socket",
  nicPorts: [20000],
  nicBackends: [{ kind: "socket", port: 20000 }, { kind: "macos-management" }],
});

expect(result).toContain("socket,id=net0,listen=127.0.0.1:20000");
expect(result).toContain("vmnet-host,id=net1");
```

- [ ] **Step 2: Run the command-builder test to verify it fails**

Run: `npm test --workspace @networkchum/api -- buildQemuCommand.test.ts`

Expected: FAIL because `nicBackends` and `vmnet-host` support do not exist yet.

- [ ] **Step 3: Add per-NIC backend input**

Refactor `BuildQemuCommandInput` so the builder can accept an optional explicit backend per NIC:

```ts
nicBackends?: Array<
  | { kind: "tap" }
  | { kind: "socket"; port: number }
  | { kind: "macos-management" }
>;
```

Use it before falling back to the current whole-node `networkBackend`.

- [ ] **Step 4: Implement the macOS management NIC arg**

Emit:

```ts
("-netdev",
  `vmnet-host,id=net${index}`,
  "-device",
  `${nicModel},netdev=net${index}`);
```

for `macos-management` NICs.

- [ ] **Step 5: Run the command-builder test to verify it passes**

Run: `npm test --workspace @networkchum/api -- buildQemuCommand.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/runtime/qemu/buildQemuCommand.ts apps/api/src/runtime/qemu/buildQemuCommand.test.ts
git commit -m "feat: add macos management nic mode to qemu builder"
```

---

### Task 4: Route macOS Management Clouds Away From Podman

**Files:**

- Modify: `apps/api/src/runtime/powerNode.ts`
- Test: `apps/api/src/runtime/powerNode.test.ts`
- Modify: `apps/api/src/network/cloudUplink.ts`

- [ ] **Step 1: Write the failing power-on tests**

Add tests that prove the current regression:

```ts
it("uses the macos management backend for management clouds instead of the NAT helper", async () => {
  // platform = macos, cloudRole = management
  // expect no podman/docker command
  // expect state.runtime === "cloud"
});

it("fails clearly when macos management backend is unavailable", async () => {
  expect(state.message).toContain("host-only management backend");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test --workspace @networkchum/api -- powerNode.test.ts`

Expected: FAIL because macOS management clouds still try to launch `alpine:latest`.

- [ ] **Step 3: Split cloud behavior by role and platform**

Refactor the `node.runtime === "cloud"` branch in `powerNode.ts` so it behaves like this:

```ts
if (cloudRole === "management" && platform === "linux") {
  // existing tap path
}

if (cloudRole === "management" && platform === "macos") {
  // capability check
  // return running cloud state without container helper
}

if (cloudRole === "management") {
  // unsupported host -> clear failure
}

// non-management clouds keep current socket/container fallback behavior
```

- [ ] **Step 4: Feed macOS management NIC intent into QEMU launch planning**

Update the pre-launch QEMU path in `powerNode.ts` so interfaces attached to management-cloud-backed networks on macOS are assigned:

```ts
{
  kind: "macos-management";
}
```

instead of a socket port.

Do not disturb Linux TAP or normal socket NICs.

- [ ] **Step 5: Re-run the focused runtime tests**

Run: `npm test --workspace @networkchum/api -- powerNode.test.ts cloudUplink.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/runtime/powerNode.ts apps/api/src/runtime/powerNode.test.ts apps/api/src/network/cloudUplink.ts
git commit -m "feat: route macos management clouds through host-only backend"
```

---

### Task 5: Show Backend And macOS Management Guidance In The UI

**Files:**

- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/components/AddNodeDialog.tsx`
- Test: `apps/web/src/components/AddNodeDialog.test.tsx`
- Modify: `apps/web/src/components/CloudNodeSettingsDialog.tsx`
- Modify: `apps/web/src/components/SelectionPanel.tsx`
- Test: `apps/web/src/components/SelectionPanel.test.tsx`

- [ ] **Step 1: Write the failing web tests**

Add tests that expect:

```ts
expect(screen.getByText(/Backend: macOS host-only management/i)).toBeInTheDocument();
expect(screen.getByText(/172.31.255.0\\/24/)).toBeInTheDocument();
expect(screen.getByText(/172.31.255.1/)).toBeInTheDocument();
```

for a mocked macOS capability payload.

- [ ] **Step 2: Run the focused web tests to verify they fail**

Run: `npm test --workspace @networkchum/web -- App.test.tsx AddNodeDialog.test.tsx SelectionPanel.test.tsx`

Expected: FAIL because the UI does not yet read or display the new capability data.

- [ ] **Step 3: Load the richer health payload in `App.tsx`**

Parse:

```ts
{
  ok: true,
  capabilities: {
    cloudManagement: {
      platform: "macos",
      managementCloudMode: "macos-host-only",
    },
  },
}
```

and store it in top-level app state.

- [ ] **Step 4: Render a visible backend label in the shell**

Render a small label near the existing bridge status, for example:

```tsx
<span className="panel-description">Backend: macOS host-only management</span>
```

or the Linux equivalent.

- [ ] **Step 5: Pass capability data into cloud-related UI**

Use the capability state to show guidance in:

- `AddNodeDialog.tsx`
- `CloudNodeSettingsDialog.tsx`
- `SelectionPanel.tsx`

Only show the subnet text when:

- the API host is macOS
- the selected/new cloud role is `management`

- [ ] **Step 6: Re-run the focused web tests**

Run: `npm test --workspace @networkchum/web -- App.test.tsx AddNodeDialog.test.tsx SelectionPanel.test.tsx`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/components/AddNodeDialog.tsx apps/web/src/components/AddNodeDialog.test.tsx apps/web/src/components/CloudNodeSettingsDialog.tsx apps/web/src/components/SelectionPanel.tsx apps/web/src/components/SelectionPanel.test.tsx
git commit -m "feat: surface macos management backend guidance in ui"
```

---

### Task 6: Update Operator And Architecture Documentation

**Files:**

- Modify: `README.md`
- Modify: `INSTALL.md`
- Modify: `docs/architecture.md`

- [ ] **Step 1: Update README**

Add a short operator-facing section:

- Linux management cloud = bridged/TAP
- macOS management cloud = host-only static subnet
- fixed subnet `172.31.255.0/24`
- host IP `172.31.255.1`

- [ ] **Step 2: Update INSTALL**

Add a macOS operator section that explains:

- no Podman/Docker requirement for management clouds
- static IP assignment expectations
- SSH workflow from the Mac host
- limitations vs Linux LAN bridging

- [ ] **Step 3: Update architecture docs**

Update the platform-networking diagrams/text so `management` cloud is explicitly split:

- Linux: TAP/bridge
- macOS: host-only management backend
- non-management macOS clouds: socket/fallback behavior

- [ ] **Step 4: Run formatting/docs verification**

Run: `npm run build --workspace @networkchum/web`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md INSTALL.md docs/architecture.md
git commit -m "docs: describe macos management cloud behavior"
```

---

### Task 7: Final Verification

**Files:**

- Test: `apps/api/src/runtime/hostCapabilities.test.ts`
- Test: `apps/api/src/runtime/macosManagementCloud.test.ts`
- Test: `apps/api/src/runtime/qemu/buildQemuCommand.test.ts`
- Test: `apps/api/src/runtime/powerNode.test.ts`
- Test: `apps/api/src/network/cloudUplink.test.ts`
- Test: `apps/web/src/App.test.tsx`
- Test: `apps/web/src/components/AddNodeDialog.test.tsx`
- Test: `apps/web/src/components/SelectionPanel.test.tsx`

- [ ] **Step 1: Run the focused API suite**

Run:

```bash
npm test --workspace @networkchum/api -- hostCapabilities.test.ts macosManagementCloud.test.ts buildQemuCommand.test.ts powerNode.test.ts cloudUplink.test.ts app.test.ts
```

Expected: PASS

- [ ] **Step 2: Run the focused web suite**

Run:

```bash
npm test --workspace @networkchum/web -- App.test.tsx AddNodeDialog.test.tsx SelectionPanel.test.tsx
```

Expected: PASS

- [ ] **Step 3: Run builds**

Run:

```bash
npm run build --workspace @networkchum/api
npm run build --workspace @networkchum/web
```

Expected: PASS

- [ ] **Step 4: Final commit**

```bash
git status --short
git add apps/api apps/web README.md INSTALL.md docs/architecture.md
git commit -m "feat: add macos management cloud backend"
```
