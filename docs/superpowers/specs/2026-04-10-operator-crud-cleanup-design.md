# NetworkChum Operator CRUD Cleanup Design

## Summary

This design cleans up NetworkChum's operator flows around four first-class resources:

- labs
- nodes
- cables
- images

The goal is to make add/delete behavior explicit, predictable, and safe without rewriting the repo around a new persistence layer. The implementation should keep the current file-backed architecture for now, add a thin service layer for resource lifecycle orchestration, and complete the missing CRUD actions in both the API and the UI.

The preferred operator experience is:

- contextual actions instead of a global admin console
- desktop right-click menus as the fast path
- a persistent right-side selection panel as the canonical fallback/details surface
- drag-from-port-to-port cable creation
- uploaded `qcow2` images managed by the app
- image "delete" meaning remove from NetworkChum's usable catalog only, not delete the stored file

## Current State

The repo already has a functional vertical slice:

- file-backed lab persistence in `apps/api/data/labs.json`
- file-backed image persistence in `apps/api/data/images.json`
- runtime state persistence in `apps/api/data/runtime-states.json`
- topology mutations for adding nodes/networks, moving nodes, and attaching/detaching interfaces
- QEMU/container power actions
- a React UI that can create labs, add nodes, drag nodes, create cables, disconnect interfaces, and open serial consoles

The current problems are structural rather than foundational:

- route handlers own too much lifecycle logic
- there is no resource-level delete orchestration for labs, nodes, and cables
- image management is API-only and scan-oriented rather than upload-oriented
- destructive actions are incomplete and inconsistent
- the UI has no consistent surface for resource actions
- the current web build is broken by a type mismatch in `apps/web/src/api/client.ts`

## Goals

- Add complete operator CRUD for labs, nodes, cables, and images.
- Keep the current repo structure and file-backed persistence for this pass.
- Make delete semantics explicit and automatic:
  - deleting a lab stops and cleans all of its nodes and overlays
  - deleting a node stops and cleans that node and its attachments
  - deleting a cable removes the hidden network object that represents it
  - deleting an image removes it from NetworkChum's usable catalog only
- Make browser upload the primary way to add images.
- Keep right-click context menus as the desktop shortcut path.
- Keep the right-side selection panel as the canonical details/action surface.
- Preserve the current native topology model of `nodes`, `networks`, and `attachments`.

## Non-Goals

- Migrate to Prisma or SQLite in this pass.
- Redesign the app into a management-console-heavy product surface.
- Implement full node edit workflows for RAM/vCPU/interface count.
- Implement permanent file purge for uploaded images.
- Build a full shared-segment management UI beyond point-to-point cable flows.
- Introduce clustering, workers, or broader runtime architecture changes.

## Product Decisions Confirmed

- Image add flow: upload `qcow2` files through the browser into app-managed storage.
- Image delete semantics: remove from NetworkChum's catalog only; keep the stored file for later explicit purge work.
- Lab delete semantics: delete immediately and automatically stop/clean all associated runtime artifacts.
- Node delete semantics: delete immediately and automatically stop/clean the node and its artifacts.
- Main action model: contextual actions, not a dedicated management console.
- Cable UX: drag from port to port to create; right-click/select cable or connected port to delete.
- Desktop UX: right-click context menus should be supported for cables, nodes, labs, and images.

## Operator Experience

### Layout

The UI should use a three-region desktop layout:

- left column: labs list and lab creation
- center: topology canvas
- right column: selection details and resource actions

The right column is the canonical action surface. Right-click context menus are shortcuts, not the only way to act.

### Resource Interactions

#### Labs

- Create from the labs column.
- Selecting a lab loads its topology and associated runtime/image actions.
- Right-clicking a lab row opens a context menu with:
  - Open
  - Delete Lab
- The selected lab row also exposes the same delete action visibly.

#### Nodes

- Add via `Add Node` from the canvas/header.
- Selecting a node populates the right panel with:
  - power on/off
  - open console
  - delete node
- Right-clicking a node opens the same actions in a context menu.

#### Cables

- Drag from one unconnected port to another to create a cable.
- Clicking or right-clicking a cable selects the represented point-to-point connection.
- The right panel shows the two endpoints and a `Disconnect` action.
- Right-clicking a cable opens a context menu with `Disconnect`.
- Right-clicking a connected port may open the same disconnect action for the cable that owns that port attachment.

#### Images

- The right panel includes an image library section.
- `Upload qcow2` opens a file picker and uploads into app-managed storage.
- Each image row shows:
  - filename
  - source type
  - bound template or unbound state
  - catalog visibility state
- Right-clicking an image opens:
  - Bind
  - Unbind
  - Remove From Catalog
- The same actions remain available in the panel without right-click.

## Confirmation And Safety Rules

All destructive actions require confirmation.

### Delete Lab Confirmation

The dialog should state that lab deletion will:

- stop running nodes in the lab
- delete runtime state for those nodes
- delete overlay disks for those nodes
- remove the lab document

If a node cannot be cleanly stopped, lab deletion should abort and report the failure.

### Delete Node Confirmation

The dialog should state that node deletion will:

- power off the node if running
- remove connected cables
- delete runtime state for the node
- delete the node's overlay disk

If runtime cleanup fails, node deletion should abort.

### Disconnect Cable Confirmation

Cable disconnect can be a lighter-weight confirm or direct action, but the UI must clearly identify the two endpoints before deletion.

### Remove Image From Catalog Confirmation

The dialog must explicitly state:

- the image will no longer appear in the usable device catalog
- the stored file will remain on disk
- this action does not purge the uploaded file

## Domain Model Changes

### Node Image Reference

`LabNode.imageId` should reference `ImageRecord.id`, not a filesystem path.

This is a necessary cleanup because the current lab records may store absolute paths in `imageId`, which couples lab documents to storage internals and makes image lifecycle management awkward.

### Compatibility Strategy

To avoid breaking existing saved labs:

- node resolution should first look up `imageId` as an image record id
- if no image record is found and `imageId` looks like an absolute path, the system should fall back to resolving by matching `ImageRecord.path`
- on the next write of that lab document, the node should be normalized to store the actual image record id

This keeps current data working while migrating toward the corrected model.

### Image Record Extensions

`ImageRecord` should gain enough metadata to support upload-based management and catalog-only deletion. The design requires these concepts:

- `source`: `upload | scan`
- `catalogState`: `active | removed`
- app-managed storage path for uploads

`templateId` continues to represent binding. A bound image appears in the usable catalog only when:

- `catalogState === active`
- `templateId` is set

Unbound uploaded images remain visible in the image library but do not appear in the add-node catalog.

Catalog-removed images also remain visible in the image library with a removed state indicator, but they do not appear in the add-node catalog.

## Backend Architecture

The current pure topology functions should remain pure. Resource lifecycle belongs in services.

### Services

Introduce a thin service layer in the API app:

- `LabService`
  - create/list/get/delete labs
- `NodeService`
  - add/delete nodes
- `CableService`
  - create/delete point-to-point cable representations
- `ImageService`
  - upload/list/bind/unbind/remove-from-catalog images
- `RuntimeCleanupService`
  - stop nodes
  - remove runtime state
  - delete overlay files/directories

### Why This Boundary

Route handlers should validate input and translate HTTP concerns only. They should not directly own multi-step delete workflows. This keeps the system easier to test and makes delete behavior consistent no matter which UI entry point triggers it.

## API Shape

### Existing Endpoints To Keep

- `GET /labs`
- `POST /labs`
- `GET /labs/:labId`
- `POST /labs/:labId/nodes`
- `POST /labs/:labId/networks`
- `POST /labs/:labId/attachments`
- `PATCH /labs/:labId/nodes/:nodeId/position`
- `POST /labs/:labId/nodes/:nodeId/power-on`
- `POST /labs/:labId/nodes/:nodeId/power-off`
- `GET /images`
- `POST /images/:imageId/bind-template`

### New Or Completed Endpoints

- `DELETE /labs/:labId`
  - stops and cleans all node runtime artifacts before removing the lab

- `DELETE /labs/:labId/nodes/:nodeId`
  - stops and cleans the node, removes its attachments, updates the lab document

- `DELETE /labs/:labId/networks/:networkId`
  - removes the network segment and all attachments that belong to it
  - for the current UI, this is the cable delete endpoint

- `POST /images/upload`
  - accepts multipart upload
  - stores the file in app-managed storage
  - creates an `ImageRecord` with `source=upload`

- `DELETE /images/:imageId/template-binding`
  - clears the bound template without deleting the image record

- `DELETE /images/:imageId`
  - catalog-only delete
  - sets `catalogState=removed`
  - does not delete the file from disk

### Response Shape Guidance

Delete endpoints should return enough information for the UI to update immediately:

- deleted resource id
- cleanup summary when relevant
- updated lab document for in-lab mutations where it reduces an extra round trip

## Image Storage Model

Uploads should be stored under the API data directory in app-managed storage. A simple location is:

- `<dataDir>/images/uploads/`

The existing scan-based image support can remain for compatibility, but upload becomes the primary operator flow.

The startup scan should not be the only way the image library is populated anymore. Uploaded images should appear immediately after successful upload and should not depend on a scan pass.

## Frontend Structure

### Selection State

The web app should have one explicit selection model:

- selected lab
- selected node
- selected cable/network
- selected image

Only one primary resource selection should drive the right panel at a time.

### Context Menus

Add reusable context menu handling for:

- lab list rows
- canvas nodes
- canvas cables
- image library rows

Context menus are a desktop accelerator. They should dispatch the same underlying actions used by visible buttons in the right panel.

### Right Panel Responsibilities

The right panel should:

- show details for the selected resource
- expose the canonical action buttons
- include the image library section
- remain usable when context menus are unavailable

This keeps the app discoverable for users who do not instinctively right-click and gives touch/trackpad/keyboard users a stable fallback.

## Delete Semantics

### Delete Lab

Implementation behavior:

1. load the lab
2. enumerate nodes
3. power off running nodes
4. remove runtime state entries for those nodes
5. delete the lab overlay directory
6. remove the lab record from persistence

### Delete Node

Implementation behavior:

1. load the lab
2. power off the node if running
3. remove all attachments for the node's interfaces
4. remove any now-unused point-to-point network objects if they only existed for those attachments
5. remove runtime state for the node
6. delete the node overlay disk
7. remove the node from the lab document

### Delete Cable

Implementation behavior:

1. identify the selected network representing the cable
2. remove attachments for that network
3. remove the network object itself

For this pass, the cable delete flow is scoped to point-to-point links created by the canvas gesture. Shared-segment editing remains out of scope.

### Delete Image

Implementation behavior:

1. load the image record
2. set `catalogState=removed`
3. keep the file in app-managed storage
4. hide it from the add-node catalog

No file purge occurs in this pass.

## Implementation Sequence

### Phase 0: Baseline Cleanup

- fix the current web build failure in `apps/web/src/api/client.ts`
- add `.superpowers/` to `.gitignore`

### Phase 1: Resource Service Layer

- introduce `LabService`, `NodeService`, `CableService`, `ImageService`, and `RuntimeCleanupService`
- move delete orchestration out of route handlers

### Phase 2: Data Model Corrections

- normalize node image references to image record ids
- extend `ImageRecord` with source and catalog state
- add upload storage helpers

### Phase 3: API Completion

- add delete lab/node/network endpoints
- add image upload and unbind endpoints
- add catalog-only image delete behavior

### Phase 4: Web Operator Surfaces

- add the image library UI
- add right panel action surfaces for selected resources
- add confirmation dialogs
- wire delete flows and optimistic refresh behavior

### Phase 5: Context Menus

- add right-click context menus for labs, nodes, cables, and images
- make them dispatch the same actions as the right panel

### Phase 6: Verification

- extend unit and route tests
- verify all CRUD flows manually
- require passing `npm test` and `npm run build`

## Testing Strategy

### API Tests

Add tests for:

- `DELETE /labs/:labId`
- `DELETE /labs/:labId/nodes/:nodeId`
- `DELETE /labs/:labId/networks/:networkId`
- `POST /images/upload`
- `DELETE /images/:imageId/template-binding`
- `DELETE /images/:imageId`
- compatibility resolution for legacy `LabNode.imageId` path values

### Service Tests

Add focused tests for:

- lab cleanup orchestration
- node cleanup orchestration
- overlay deletion behavior
- catalog-only image delete behavior

### Web Tests

Add component/integration tests for:

- right panel action rendering by selection type
- node delete confirmation flow
- cable disconnect via selection and via right-click
- image upload/bind/unbind/remove-from-catalog flows
- context menu invocation on desktop

### Final Verification

The cleanup is only complete when:

- all workspace tests pass
- the workspace build passes
- a user can create and delete labs
- a user can add and delete nodes
- a user can create and delete cables
- a user can upload, bind, unbind, and remove images from the usable catalog

## Risks And Trade-Offs

- File-backed persistence remains simpler than the original Prisma/SQLite plan, but it keeps this pass focused and avoids a data-layer rewrite during operator cleanup.
- Right-click menus improve desktop ergonomics but must never be the only way to reach actions.
- Keeping uploaded files after catalog delete is safer and matches the chosen semantics, but it requires clear UI language to avoid operator confusion.
- Backward compatibility for legacy path-based `imageId` values adds some migration complexity, but it is less risky than breaking saved labs.

## Recommended Next Step

Write an implementation plan for the cleanup in this order:

1. baseline fixes
2. service layer
3. data model corrections
4. API completion
5. UI action surfaces
6. context menus
7. verification
