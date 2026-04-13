# Role-Based Node Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic canvas node boxes with role-shaped glyphs, add template-level role icon persistence with auto-guessing, and expose role override in the existing device edit flow.

**Architecture:** Add a first-class `deviceRoleIcon` enum to shared template/catalog types, persist overrides in the existing template override store, and centralize filename/vendor/runtime guessing in a dedicated backend helper. The web app should consume that role as the single source of truth for both device catalog icons and the new option-`C` canvas node rendering.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest, Vite SVG rendering via inline React SVG paths.

---

## File Structure

- Modify: `packages/shared/src/catalog.ts`
  - Add the shared `DeviceRoleIcon` enum/schema to template metadata.
- Modify: `packages/shared/src/catalog.test.ts`
  - Add shared schema coverage for the new role field.
- Create: `apps/api/src/templates/deviceRoleIcon.ts`
  - Contain deterministic role-guess logic and exported role enum helpers for the API layer.
- Modify: `apps/api/src/templates/templateOverrideStore.ts`
  - Persist `deviceRoleIcon` alongside existing template defaults overrides.
- Modify: `apps/api/src/templates/templateRegistry.ts`
  - Apply stored role overrides and expose role-aware template updates.
- Modify: `apps/api/src/routes/templates.ts`
  - Accept and validate `deviceRoleIcon` in the existing template edit route.
- Modify: `apps/api/src/catalog/getCatalog.ts`
  - Ensure catalog entries always surface an explicit role, guessed when needed.
- Modify: `apps/api/src/images/imageStore.ts`
  - Reuse existing image metadata reads as inputs to the guesser when binding/discovering images.
- Create: `apps/api/src/templates/deviceRoleIcon.test.ts`
  - Cover deterministic guess behavior for common names.
- Modify: `apps/api/src/app.test.ts`
  - Extend template update API coverage to include role icon persistence.
- Modify: `apps/web/src/api/client.ts`
  - Thread `deviceRoleIcon` through template/catalog client types and update payloads.
- Create: `apps/web/src/icons/deviceRoleIcons.tsx`
  - Hold role-to-SVG path mapping and reusable role glyph components.
- Modify: `apps/web/src/icons/deviceIcons.tsx`
  - Replace runtime-only icon helpers with role-aware helpers or retire this file into a compatibility wrapper.
- Modify: `apps/web/src/components/TemplateEditorDialog.tsx`
  - Add `Role Icon` dropdown to the existing edit flow.
- Modify: `apps/web/src/components/TemplateEditorDialog.test.tsx`
  - Add UI coverage for editing and saving the role icon.
- Modify: `apps/web/src/components/DeviceCatalog.tsx`
  - Render role-based icons from template metadata instead of runtime buckets.
- Modify: `apps/web/src/components/DeviceCatalog.test.tsx`
  - Verify rendered role icons and metadata remain correct.
- Modify: `apps/web/src/components/TopologyCanvas.tsx`
  - Replace generic rounded node boxes with role-shaped node glyphs using the approved `C` layout.
- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
  - Verify node role rendering, selection styling, and name/status placement.
- Modify: `apps/web/src/App.tsx`
  - Propagate role icon data into the catalog, template edit dialog, and canvas node rendering.
- Modify: `apps/web/src/App.test.tsx`
  - Cover end-to-end role edit behavior from the app shell.

## Task 1: Add Shared Role Metadata

**Files:**

- Modify: `packages/shared/src/catalog.ts`
- Modify: `packages/shared/src/catalog.test.ts`

- [ ] **Step 1: Write the failing shared-schema test**

```ts
it("accepts templates with a role-based device icon", () => {
  const result = TemplateSchema.parse({
    id: "cisco-csr",
    runtime: "qemu",
    displayName: "CSR1000v",
    vendor: "Cisco",
    deviceRoleIcon: "router",
    boot: { console: "serial", acceleration: "kvm" },
    configSchema: {
      ramMb: { default: 4096, min: 1024, max: 16384 },
      vcpu: { default: 2, min: 1, max: 8 },
      interfaceCount: { default: 8, min: 1, max: 24 },
    },
  });

  expect(result.deviceRoleIcon).toBe("router");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @networkchum/shared -- src/catalog.test.ts`
Expected: FAIL because `deviceRoleIcon` is not part of `TemplateSchema`

- [ ] **Step 3: Add the shared enum and schema**

```ts
export const DeviceRoleIconSchema = z.enum([
  "router",
  "switch",
  "firewall",
  "cloud",
  "host",
  "client",
]);
```

Then add:

```ts
deviceRoleIcon: DeviceRoleIconSchema,
```

to `TemplateSchema`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @networkchum/shared -- src/catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/catalog.ts packages/shared/src/catalog.test.ts
git commit -m "feat: add shared device role icon schema"
```

## Task 2: Add Backend Guesser And Override Persistence

**Files:**

- Create: `apps/api/src/templates/deviceRoleIcon.ts`
- Create: `apps/api/src/templates/deviceRoleIcon.test.ts`
- Modify: `apps/api/src/templates/templateOverrideStore.ts`
- Modify: `apps/api/src/templates/templateRegistry.ts`
- Modify: `apps/api/src/catalog/getCatalog.ts`

- [ ] **Step 1: Write the failing guesser tests**

```ts
it.each([
  ["csr1000v.qcow2", "Cisco", "qemu", "router"],
  ["asav-9.18.qcow2", "Cisco", "qemu", "firewall"],
  ["veos-4.33.qcow2", "Arista", "qemu", "switch"],
  ["ubuntu-22.04.qcow2", "Linux", "container", "host"],
  ["cloud", "NetworkChum", "cloud", "cloud"],
])("guesses %s as %s", (name, vendor, runtime, expected) => {
  expect(guessDeviceRoleIcon({ name, vendor, runtime })).toBe(expected);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @networkchum/api -- src/templates/deviceRoleIcon.test.ts`
Expected: FAIL because the helper does not exist

- [ ] **Step 3: Implement deterministic guessing**

Create a focused helper:

```ts
export function guessDeviceRoleIcon(input: {
  name: string;
  vendor?: string;
  runtime?: string;
}): DeviceRoleIcon {
  const haystack = `${input.vendor ?? ""} ${input.name}`.toLowerCase();
  // cloud -> firewall -> switch -> router -> host -> client -> fallback
}
```

Use exact substring tables from the approved spec.

- [ ] **Step 4: Extend template overrides to persist the role**

Update the override type:

```ts
export type TemplateDefaultsOverride = Partial<{
  ramMb: number;
  vcpu: number;
  interfaceCount: number;
  deviceRoleIcon: DeviceRoleIcon;
}>;
```

Ensure `TemplateRegistry.applyTemplateOverride()` copies `deviceRoleIcon` from override or base template.

- [ ] **Step 5: Apply guessed role when catalog/templates are materialized**

If a template has no explicit override, populate `deviceRoleIcon` from:

- built-in template value when present
- otherwise `guessDeviceRoleIcon({ name: template.displayName, vendor: template.vendor, runtime: template.runtime })`

Do this in one place, preferably inside `TemplateRegistry`, so `getCatalog()` and `/templates` stay consistent.

- [ ] **Step 6: Run the focused backend tests**

Run:

- `npm run test --workspace @networkchum/api -- src/templates/deviceRoleIcon.test.ts`
- `npm run test --workspace @networkchum/api -- src/app.test.ts`

Expected: PASS for new guesser tests; existing API tests stay green

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/templates/deviceRoleIcon.ts apps/api/src/templates/deviceRoleIcon.test.ts apps/api/src/templates/templateOverrideStore.ts apps/api/src/templates/templateRegistry.ts apps/api/src/catalog/getCatalog.ts
git commit -m "feat: add backend device role icon guessing"
```

## Task 3: Extend Template Edit API With Role Icon

**Files:**

- Modify: `apps/api/src/routes/templates.ts`
- Modify: `apps/api/src/app.test.ts`

- [ ] **Step 1: Write the failing API test for template role updates**

Add a test alongside existing template update coverage:

```ts
expect(patchResponse.json()).toEqual({
  template: expect.objectContaining({
    id: "cisco-iosv",
    deviceRoleIcon: "router",
  }),
});
```

Use a second patch to confirm persistence:

```ts
const templatesResponse = await app.inject({
  method: "GET",
  url: "/templates",
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @networkchum/api -- src/app.test.ts`
Expected: FAIL because `/templates/:templateId` does not accept `deviceRoleIcon`

- [ ] **Step 3: Update route validation and registry update**

Extend the request schema:

```ts
deviceRoleIcon: DeviceRoleIconSchema,
```

and pass it to `registry.updateDefaults()` as part of the update payload.

- [ ] **Step 4: Run API test to verify it passes**

Run: `npm run test --workspace @networkchum/api -- src/app.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/templates.ts apps/api/src/app.test.ts
git commit -m "feat: allow template role icon updates"
```

## Task 4: Add Role Icon To The Existing Template Edit Dialog

**Files:**

- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/components/TemplateEditorDialog.tsx`
- Create or Modify: `apps/web/src/components/TemplateEditorDialog.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write the failing dialog test**

```tsx
it("shows a role icon selector and submits the chosen value", async () => {
  render(
    <TemplateEditorDialog
      template={{ ...template, deviceRoleIcon: "router" }}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("Role Icon"), {
    target: { value: "firewall" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Template" }));

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ deviceRoleIcon: "firewall" }),
    );
  });
});
```

- [ ] **Step 2: Run the focused dialog test to verify it fails**

Run: `npm run test --workspace @networkchum/web -- src/components/TemplateEditorDialog.test.tsx`
Expected: FAIL because the dialog has no `Role Icon` field

- [ ] **Step 3: Extend the client and dialog types**

Update `api/client.ts` and `App.tsx` types to include `deviceRoleIcon`.

Add a new selector in `TemplateEditorDialog.tsx`:

```tsx
<label>
  <span className="field-label">Role Icon</span>
  <select
    value={deviceRoleIcon}
    onChange={(event) =>
      setDeviceRoleIcon(event.target.value as DeviceRoleIcon)
    }
    className="field-input"
  >
    <option value="router">Router</option>
    <option value="switch">Switch</option>
    <option value="firewall">Firewall</option>
    <option value="cloud">Cloud</option>
    <option value="host">Host</option>
    <option value="client">Client</option>
  </select>
</label>
```

- [ ] **Step 4: Thread the new field through `App.tsx`**

When the dialog saves, call `api.updateTemplate()` with:

```ts
{
  vcpu,
  ramMb,
  interfaceCount,
  deviceRoleIcon,
}
```

and apply the updated template back into the local catalog state.

- [ ] **Step 5: Run the focused web tests**

Run:

- `npm run test --workspace @networkchum/web -- src/components/TemplateEditorDialog.test.tsx`
- `npm run test --workspace @networkchum/web -- src/App.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/components/TemplateEditorDialog.tsx apps/web/src/components/TemplateEditorDialog.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: add template role icon edit flow"
```

## Task 5: Replace Runtime Icons With Role Icons In The Catalog

**Files:**

- Create: `apps/web/src/icons/deviceRoleIcons.tsx`
- Modify: `apps/web/src/icons/deviceIcons.tsx`
- Modify: `apps/web/src/components/DeviceCatalog.tsx`
- Modify: `apps/web/src/components/DeviceCatalog.test.tsx`

- [ ] **Step 1: Write the failing catalog test**

Add a test that asserts a firewall role renders a firewall icon even when runtime is `qemu`:

```tsx
expect(screen.getByTestId("device-icon-firewall")).toBeInTheDocument();
expect(screen.queryByTestId("device-icon-vm")).not.toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @networkchum/web -- src/components/DeviceCatalog.test.tsx`
Expected: FAIL because the catalog still keys off `runtime`

- [ ] **Step 3: Add a dedicated role icon map**

Create `deviceRoleIcons.tsx` with reusable glyph components and a helper such as:

```tsx
export function getDeviceRoleIcon(role: DeviceRoleIcon) {
  return roleIconMap[role];
}
```

Keep all SVG paths inline so the rendering stays self-contained and testable.

- [ ] **Step 4: Update `DeviceCatalog.tsx` to render by role**

Replace `getDeviceIconKind(entry.runtime)` with `entry.deviceRoleIcon`.

Keep the rest of the card structure intact; this task is only about correct role rendering, not layout redesign.

- [ ] **Step 5: Run catalog test to verify it passes**

Run: `npm run test --workspace @networkchum/web -- src/components/DeviceCatalog.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/icons/deviceRoleIcons.tsx apps/web/src/icons/deviceIcons.tsx apps/web/src/components/DeviceCatalog.tsx apps/web/src/components/DeviceCatalog.test.tsx
git commit -m "feat: render catalog icons from template roles"
```

## Task 6: Redesign Canvas Nodes To Use Role Glyphs

**Files:**

- Modify: `apps/web/src/components/TopologyCanvas.tsx`
- Modify: `apps/web/src/components/TopologyCanvas.test.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Write the failing canvas test**

Add a focused render test for a firewall node:

```tsx
render(
  <TopologyCanvas
    labName="Lab"
    labId="lab-1"
    nodes={[
      {
        id: "node-1",
        name: "ASA-1",
        runtime: "qemu",
        deviceRoleIcon: "firewall",
        position: { x: 100, y: 100 },
      },
    ]}
  />,
);

expect(screen.getByTestId("canvas-node-firewall-node-1")).toBeInTheDocument();
```

Also add an assertion that the node label is rendered outside the old generic box structure.

- [ ] **Step 2: Run canvas test to verify it fails**

Run: `npm run test --workspace @networkchum/web -- src/components/TopologyCanvas.test.tsx`
Expected: FAIL because the canvas still renders the generic rounded box

- [ ] **Step 3: Thread role metadata into the canvas**

Extend the canvas node type with:

```ts
deviceRoleIcon?: DeviceRoleIcon;
```

Update `App.tsx` so nodes passed to the canvas include their template role.

- [ ] **Step 4: Implement the approved option-`C` layout**

Replace the generic rectangle body with a role glyph container that:

- is centered on the existing node position
- keeps pointer/selection behavior intact
- renders name and status below the glyph
- uses glow/outline color for selection and power state

Do not redesign cable behavior in this task; preserve current interaction semantics.

- [ ] **Step 5: Run focused canvas and app tests**

Run:

- `npm run test --workspace @networkchum/web -- src/components/TopologyCanvas.test.tsx`
- `npm run test --workspace @networkchum/web -- src/App.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/TopologyCanvas.tsx apps/web/src/components/TopologyCanvas.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat: render topology nodes as role glyphs"
```

## Task 7: Full Verification

**Files:**

- No new code

- [ ] **Step 1: Run the shared tests**

Run: `npm run test --workspace @networkchum/shared`
Expected: PASS

- [ ] **Step 2: Run the focused API tests**

Run:

- `npm run test --workspace @networkchum/api -- src/templates/deviceRoleIcon.test.ts`
- `npm run test --workspace @networkchum/api -- src/app.test.ts`

Expected: PASS

- [ ] **Step 3: Run the focused web tests**

Run:

- `npm run test --workspace @networkchum/web -- src/components/TemplateEditorDialog.test.tsx`
- `npm run test --workspace @networkchum/web -- src/components/DeviceCatalog.test.tsx`
- `npm run test --workspace @networkchum/web -- src/components/TopologyCanvas.test.tsx`
- `npm run test --workspace @networkchum/web -- src/App.test.tsx`

Expected: PASS

- [ ] **Step 4: Run builds**

Run:

- `npm run build --workspace @networkchum/shared`
- `npm run build --workspace @networkchum/api`
- `npm run build --workspace @networkchum/web`

Expected: PASS

- [ ] **Step 5: Manual smoke test**

Verify:

1. a CSR-like image guesses `router`
2. an ASA/SRX/FortiGate-like image guesses `firewall`
3. a vEOS/IOSvL2-like image guesses `switch`
4. the device edit dialog can override the guess
5. the catalog updates to the selected role icon
6. canvas nodes render as role glyphs instead of generic boxes
7. node name and running state remain legible on dense topologies

- [ ] **Step 6: Final commit**

```bash
git add .
git commit -m "feat: add role-based node icon system"
```
