# Cloud Node + Icon System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix cloud node (multiple interfaces, selection panel, cabling) + add device-type icons to canvas and catalog.

**Architecture:** Add `@mdi/svg` for icons. Map `runtime` + `vendor` to SVG paths. Propagate `templateId`/`runtime` through canvas node type. Bump cloud interface default. Add interface count override to node creation. Add interface list to SelectionPanel. Fix Zod schema for cloud zeros.

---

### Task 1: Fix Zod schemas for cloud zeros

**Files:**

- `packages/shared/src/catalog.ts`
- `packages/shared/src/topology.ts`

Change `.positive()` to `.nonnegative()` for `ramMb` and `vcpu` in `NumberLimitSchema` (catalog.ts) and `NodeConfigSchema` (topology.ts). Cloud template has `default: 0` which fails `.positive()`.

**Verify:** `npx tsc --noEmit -p apps/api/tsconfig.json`

---

### Task 2: Bump cloud interface default + fix catalog display

**Files:**

- `apps/api/src/templates/defaultTemplates.ts`
- `apps/web/src/App.tsx`

Change cloud template `interfaceCount` from `{ default: 1, min: 1, max: 8 }` to `{ default: 10, min: 1, max: 24 }` in both files.

In `apps/web/src/components/DeviceCatalog.tsx`, fix runtime label: add `"cloud"` case returning `"Cloud"` in the vendor/runtime metadata. Skip "0 vCPU • 0 MB RAM" display when `runtime === "cloud"`.

**Verify:** `npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json`

---

### Task 3: Add `interfaceCount` override to node creation

**Files:**

- `packages/shared/src/topology.ts`
- `apps/api/src/routes/labs.ts`
- `apps/api/src/topology/mutations.ts`
- `apps/web/src/components/AddNodeDialog.tsx`
- `apps/web/src/App.tsx`

**Backend:**

- In `labs.ts`, add `interfaceCount: z.number().int().min(1).optional()` to `addNodeSchema`
- In `mutations.ts`, change `addNode` to use `input.interfaceCount ?? input.template.configSchema.interfaceCount.default` instead of always using template default

**Frontend:**

- In `AddNodeDialog.tsx`, add an interface count number input field (only shown when template has `interfaceCount` with `min !== max`). Use template min/max as bounds. Default to template default.
- Update `onSubmit` type to include `interfaceCount?: number`
- In `App.tsx`, pass `interfaceCount` through to the API call

**Verify:** `npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json`

---

### Task 4: Add interface list to SelectionPanel

**Files:**

- `apps/web/src/components/SelectionPanel.tsx`

When a node is selected, show a list of its interfaces with connection status:

- Each interface shows `name` (e.g. "eth0")
- If interface has an attachment (cable connected), show which network it's connected to
- If not attached, show "Not connected"
- Click interface -> trigger cable mode or show cable dialog

This requires:

- Extend `SelectionPanelProps` node type to include `interfaces` and `attachments`
- Pass interfaces + attachments from App.tsx when building the selection object
- Render an `<ul>` of interfaces with status badges

**Verify:** `npx tsc --noEmit -p apps/web/tsconfig.json`

---

### Task 5: Install `@mdi/svg` and create icon mapping

**Files:**

- Create: `apps/web/src/icons/deviceIcons.ts`
- `apps/web/package.json` (add dependency)

**Step 1:** `cd apps/web && npm install @mdi/svg`

**Step 2:** Create icon mapping. `@mdi/svg` provides SVG path data (`d` attribute) keyed by icon name. Import paths and map to device types:

```ts
import mdiCloudOutline from "@mdi/svg/svg/cloud-outline.svg?raw";
import mdiRouterWireless from "@mdi/svg/svg/router-wireless.svg?raw";
import mdiSwitch from "@mdi/svg/svg/switch.svg?raw";
import mdiShieldLock from "@mdi/svg/svg/shield-lock.svg?raw";
import mdiCubeOutline from "@mdi/svg/svg/cube-outline.svg?raw";
import mdiServer from "@mdi/svg/svg/server.svg?raw";
import mdiDesktopClassic from "@mdi/svg/svg/desktop-classic.svg?raw";
```

Note: may need `vite-plugin-svgr` or raw SVG imports. Alternative: copy just the `<path d="...">` data into a TypeScript object (zero deps). Prefer the inline approach — extract path data into a simple object:

```ts
// apps/web/src/icons/deviceIcons.ts
export type DeviceIcon = { path: string; viewBox: string };

const icons: Record<string, DeviceIcon> = {
  cloud: { path: "M...", viewBox: "0 0 24 24" },
  router: { path: "M...", viewBox: "0 0 24 24" },
  switch: { path: "M...", viewBox: "0 0 24 24" },
  firewall: { path: "M...", viewBox: "0 0 24 24" },
  container: { path: "M...", viewBox: "0 0 24 24" },
  server: { path: "M...", viewBox: "0 0 24 24" },
  generic: { path: "M...", viewBox: "0 0 24 24" },
};

export function getDeviceIcon(runtime: string, vendor?: string): DeviceIcon {
  if (runtime === "cloud") return icons.cloud;
  if (runtime === "container") return icons.container;
  // Could expand with vendor-specific icons later
  return icons.server; // default for qemu
}
```

Manually download SVGs from opensvg.dev for: cloud-outline, router-wireless, switch, shield-lock, cube-outline, server. Extract `d` attribute from each.

---

### Task 6: Render icons in TopologyCanvas

**Files:**

- `apps/web/src/components/TopologyCanvas.tsx`

**Step 1:** Add `runtime` and optionally `templateId` to the `CanvasNode` type (lines 5-11).

**Step 2:** Where canvas nodes are built from lab data (look for where `CanvasNode` objects are created from `LabNode`), propagate `runtime` from the lab node.

**Step 3:** In the node rendering section (lines 822-881), add an SVG icon above or inside the node rectangle. Increase `NODE_HEIGHT` from 48 to ~64 to fit icon + text. Render:

```tsx
<svg viewBox={icon.viewBox} width={20} height={20} x={x + 40} y={y + 4}>
  <path d={icon.path} fill="currentColor" />
</svg>
```

Shift the name text down to accommodate icon.

---

### Task 7: Render icons in DeviceCatalog

**Files:**

- `apps/web/src/components/DeviceCatalog.tsx`

Add icon next to device name in each catalog card. Import `getDeviceIcon`, render small inline SVG:

```tsx
<svg viewBox={icon.viewBox} width={16} height={16}>
  <path d={icon.path} fill="currentColor" />
</svg>
```

---

### Task 8: Final verification

Run full typecheck: `npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json`

Manual smoke test:

1. Cloud appears in catalog with cloud icon and "Cloud" badge
2. Add cloud to canvas — shows cloud icon, not generic box
3. AddNodeDialog lets you set interface count for cloud (4 default)
4. Select cloud node — SelectionPanel shows 4 interfaces with status
5. Right-click cloud -> Add Cable -> works with all 4 interfaces
6. Other device types show appropriate icons (server/router/container)
7. Power on cloud — VMs on same segment get LAN access
