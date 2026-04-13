# Role-Based Node Icon Design

## Summary

This design replaces NetworkChum's generic rounded node boxes with role-shaped node glyphs and introduces a first-class, template-level icon role system. The chosen visual direction is the "C" concept: the node body becomes the role glyph itself, with name and state rendered below the icon rather than inside a generic rectangle.

The system should:

- render canvas nodes as role icons, not generic labeled boxes
- use the same role language in the device catalog
- auto-guess a sensible role for image-backed templates
- let the operator override that guess through the existing device edit flow

The approved model is template-level role assignment with deterministic auto-guess and manual override.

## Current State

The repo already has a basic icon system, but it is too coarse for the desired UI:

- canvas nodes render as the same rounded rectangle regardless of device role
- the icon is a small badge inside the box rather than the box itself
- catalog entries derive a very rough icon kind from runtime only: `cloud`, `container`, or `vm`
- there is no template-level icon role field
- there is no override flow for visual identity in the device edit experience

This makes the topology harder to scan visually and does not reflect common network roles such as router, switch, or firewall.

## Goals

- Replace generic canvas boxes with role-shaped node glyphs.
- Use a shared role-icon vocabulary across canvas and device catalog.
- Store icon role at the template/catalog level.
- Auto-guess role from template/image metadata and filenames.
- Allow the operator to override the guessed role in the existing device `Edit` dialog.
- Keep the system deterministic and easy to reason about.

## Non-Goals

- Do not add per-node icon overrides in this pass.
- Do not create vendor-specific art for every appliance family.
- Do not build a separate icon-management screen.
- Do not redesign topology semantics, cable logic, or runtime behavior.

## Approved Product Decisions

- Visual direction: option `C`, with a distinct role glyph as the node body and the label/status rendered beneath it.
- Role model: template-level icon role with auto-guess plus manual override.
- Edit flow: icon role selection belongs in the existing device `Edit` dialog, not inline on catalog cards.
- Icon taxonomy is role-based rather than device-specific.

## Role Model

Introduce a new template/catalog field:

- `deviceRoleIcon`

Initial enum:

- `router`
- `switch`
- `firewall`
- `cloud`
- `host`
- `client`

This role is the source of truth for rendering both:

- device catalog cards
- placed nodes on the canvas

Placed nodes should not duplicate the role field. Nodes should inherit visual identity from the template used to create them.

## Auto-Guess Rules

The guesser should be deterministic, conservative, and easy to override.

### Rule Order

#### Cloud

Use `cloud` when:

- runtime/template is `cloud`
- or the name includes `cloud`, `internet`, or `mgmt`

#### Firewall

Use `firewall` when vendor/name includes:

- `asa`
- `asav`
- `srx`
- `vsrx`
- `fortigate`
- `fortios`
- `panos`
- `palo alto`
- `checkpoint`

#### Switch

Use `switch` when vendor/name includes:

- `veos`
- `eos`
- `iosvl2`
- `nxos`
- `nx-os`
- `switch`
- `cat9k`
- `catalyst`

#### Router

Use `router` when vendor/name includes:

- `csr`
- `iosv`
- `router`
- `asr`
- `isr`
- `xr`
- `junos`
- `vmx`
- `vyos`

#### Host

Use `host` when:

- runtime is `container`
- or the name includes `alpine`, `ubuntu`, `debian`, `linux`, `server`, `host`

#### Client

Use `client` only when the name clearly indicates:

- `client`
- `workstation`
- `desktop`
- `pc`

### Fallbacks

When no strong match exists:

- default to `router` for network appliance images
- default to `host` for Linux/container images

If the system cannot infer anything reliable, the template still gets a default role, but the edit dialog remains the operator escape hatch.

## UI Changes

### Canvas

Canvas nodes should render as role glyphs rather than generic rounded boxes.

The chosen visual system is:

- a larger silhouette/icon body that visually represents the role
- the node name rendered beneath the glyph
- the running/stopped state rendered beneath or beside the name
- selection, hover, and power state expressed through outline/glow color, not through reverting to generic boxes

The node should remain easy to drag and select. Cable anchors should attach cleanly to the glyph bounds so links still read clearly.

### Device Catalog

Each device card should display the current role icon next to the device name.

The device card remains compact and list-friendly, but the icon should now reflect:

- `router`
- `switch`
- `firewall`
- `cloud`
- `host`
- `client`

This keeps the catalog and canvas visually aligned.

### Device Edit Dialog

Extend the existing device `Edit` dialog with:

- `Role Icon` dropdown

The dropdown should show the same role options as the enum. Saving the edit updates the template/catalog record, which in turn updates canvas rendering for nodes that use that template.

## Data Model Changes

Add `deviceRoleIcon` to the template/catalog model used by the API and web app. The field should be persisted anywhere template configuration is already stored and edited.

The auto-guesser should run when:

- built-in or discovered image-backed templates are materialized into catalog entries
- images are uploaded and bound to templates
- existing template records missing a role are loaded or normalized

The operator-selected override should replace the guessed value and become durable.

## Rendering Architecture

The current `cloud/container/vm` icon helper should be replaced with a richer role-based icon system.

Recommended structure:

- a shared `DeviceRoleIcon` type and role-to-SVG mapping in the web app
- canvas rendering that asks for the template's role icon, not just runtime
- catalog rendering that uses the same role map

This keeps one source of truth for icon art and avoids duplicated logic between the catalog and canvas.

## Migration Strategy

Existing templates and image bindings will not already have `deviceRoleIcon`.

Migration should be lazy and safe:

- if a template already has an explicit `deviceRoleIcon`, use it
- otherwise compute a guessed role from runtime/vendor/name
- persist that guessed value on next write or via template normalization

This avoids breaking existing labs while making the new system visible immediately.

## Risks And Tradeoffs

### Inherited Template Role

Using the template as the source of truth keeps the system simple, but it means one template cannot appear as two different roles in the same lab without a second template entry.

This is acceptable for the current scope and is preferable to introducing per-node override complexity.

### Auto-Guess Accuracy

Filename/vendor guessing will never be perfect. The design intentionally favors deterministic heuristics plus manual override rather than overcomplicated classification.

### Canvas Density

The option `C` style is more expressive than the current layout, but it changes node density and label placement. The implementation should keep labels legible and avoid overly large glyphs that make dense topologies unusable.

## Testing Strategy

### Unit Tests

- icon-role guesser returns the expected role for common names:
  - `csr` -> `router`
  - `asa` / `srx` / `fortigate` -> `firewall`
  - `veos` / `iosvl2` -> `switch`
  - Linux/container names -> `host`
- template edit mutations persist `deviceRoleIcon`
- catalog rendering uses explicit role when present

### UI Tests

- device edit dialog exposes `Role Icon`
- saving a role update changes the icon shown in the catalog
- canvas node rendering uses the template role rather than runtime-only icon kind
- labels/status remain visible for selected and running nodes

### Manual Smoke Tests

- import or bind representative images and confirm the initial role guess is sensible
- override a guessed role from the device edit dialog
- confirm existing nodes using that template update to the new role rendering
- verify dense topologies remain usable and links still anchor cleanly

## Implementation Outline

1. Add the new template/catalog role field and persistence wiring.
2. Add deterministic auto-guess logic with tests.
3. Extend the device edit dialog with `Role Icon`.
4. Replace the current runtime-only icon helper with a role-based icon map.
5. Redesign canvas node rendering to use the approved `C` silhouette style.
6. Update catalog cards to use the same role icons.
7. Verify migration and backfill behavior for existing templates.
