# Containers Tab Design

## Summary

This design adds a first-class `Containers` tab to NetworkChum so operators can work with container images separately from VM disk images.

The approved operator model is:

- the existing `Devices` tab stays focused on addable device templates
- VM entries appear there only when a qcow2 image is actively bound
- built-in cloud and container entries remain visible
- a new `Containers` tab handles container-image discovery and pull workflows
- the operator can choose an image already present on the server or search/pull a new image
- after choosing an image, the operator gets a dialog with two actions:
  - `Save as reusable template` (default)
  - `Create one-off node in current lab`

The user also confirmed:

- runtime should be auto-detected from the host
- Docker Hub should be the default registry
- registry selection should exist from the start
- direct references like `oraclelinux:9-slim` must work
- top-level reusable container templates should only store image/runtime identity and simple launch metadata
- app-specific environment variables, ports, mounts, and other service behavior belong to device-specific templates later, not the top-level default catalog

## Current State

The repo already supports running container nodes, but the operator experience is static:

- container entries in the catalog come only from built-in templates
- there is no first-class UI for listing container images on the host
- there is no registry search or pull workflow
- there is no API surface for runtime detection, local image listing, or image pulls
- there is no concept of user-created reusable container templates persisted outside the built-in template list

This means container runtime support exists internally, but operators cannot manage container sources from the app itself.

## Goals

- Add a dedicated `Containers` tab to the main workflow UI.
- Detect the available container runtime on the host automatically.
- Let operators browse images already present on the host.
- Let operators search a registry and pull a new image by search result or direct image reference.
- Default remote search to Docker Hub while allowing registry selection.
- Let operators save a pulled/local image as a reusable container template.
- Let operators create a one-off node directly into the active lab from the same flow.
- Keep container-image workflows separate from VM disk-image workflows.

## Non-Goals

- Do not add environment-variable, port-publish, bind-mount, or advanced runtime configuration in this pass.
- Do not add private-registry credential management in this pass.
- Do not attempt full container lifecycle management beyond image discovery, pull, template creation, and node creation.
- Do not replace the current runtime launch model for container nodes.
- Do not redesign the existing `Devices` tab beyond the catalog filtering already approved.

## Product Decisions Confirmed

- The new capability belongs in a new `Containers` tab, not inside the current `Devices` tab.
- The dialog must support both reusable-template creation and one-off node creation.
- The default action in that dialog should be `Save as reusable template`.
- Runtime selection should not be manual in the first pass; the app should detect the available engine.
- Docker Hub should be the default registry, but registry selection should exist in the UI from the beginning.
- Container-template persistence should be lightweight and image-centric, not application-service-centric.

## UX Model

## Left Navigation

Add a new top-level workflow tab:

- `Devices`
- `Containers`
- existing image/lab flows remain unchanged

The `Devices` tab remains the source for drag/add workflows using reusable templates. The `Containers` tab becomes the source for container-image discovery and template/node creation.

## Containers Tab Layout

The tab should have two primary sections:

### Local Images

Shows container images already available on the detected runtime.

Each row should show:

- repository/image name
- tag
- registry or source if known
- runtime engine detected for the host

Actions per row:

- `Use...`

Clicking `Use...` opens the container action dialog.

### Search / Pull

Shows:

- registry selector
- search/input field
- search action
- optional direct pull action when the input looks like a full image reference

The search field should support:

- plain names like `oraclelinux`
- tagged refs like `oraclelinux:9-slim`
- fully qualified refs later without breaking the UX

The default registry should be Docker Hub. Search results should be shown as selectable rows that also feed the same container action dialog.

If the operator enters a direct reference and chooses pull, the app should pull first, then open the same save/create flow using the resolved local image.

## Container Action Dialog

The dialog opens after selecting a local image or a search result.

Fields:

- image reference
- registry
- detected runtime
- display name
- optional shell/command default if we expose it in the first pass
- action choice:
  - `Save as reusable template` (default)
  - `Create one-off node in current lab`

Behavior:

- `Save as reusable template`
  - persists a user-defined container template
  - the new template appears in `Devices`
- `Create one-off node in current lab`
  - creates a container node immediately in the active lab
  - does not require the template to be saved first

If there is no active lab and the operator chooses one-off creation, the dialog should block submission with a clear message.

## Data Model

## Reusable Container Template

Introduce persisted user-defined container templates separate from the built-in template list.

Recommended fields:

- `id`
- `runtime: "container"`
- `displayName`
- `vendor`
- `imageRef`
- `registry`
- `engine`
- `defaultCommand` or `shell`
- `configSchema`
  - `ramMb`
  - `vcpu`
  - `interfaceCount`
- optional `deviceRoleIcon`

This should be a new template store, not a misuse of template overrides. Built-in templates and user templates should both flow through the same registry/list API by the time they reach the UI, but persistence should stay distinct.

## One-Off Container Node

When creating a one-off node:

- generate a temporary or deterministic template payload from the chosen image
- create the node directly in the active lab using container runtime
- persist only what is required for the node itself

One-off creation should not silently create a reusable template unless the operator chose that path.

## Backend Design

## Runtime Detection

Add runtime detection in API:

- prefer `podman` when available
- otherwise use `docker`
- expose detected runtime to the UI

If no supported runtime is installed, the `Containers` tab should show a clear empty/error state rather than partially rendering broken actions.

## Local Image Listing

Add an API route that returns local images from the detected runtime.

Returned fields should include enough to:

- show a usable image list in the UI
- preserve the exact pullable reference when present

## Registry Search

Add an API route that supports registry-backed search.

First-pass behavior:

- default registry: Docker Hub
- explicit registry selector in request
- support direct reference input for pull even if search results are sparse

The server should own registry calls so the browser does not directly manage registry-specific details.

## Pull Image

Add an API route that:

- accepts registry + image reference
- runs `podman pull` or `docker pull` using the detected runtime
- refreshes local image state after success

The route should return the resolved local image metadata needed by the next step in the dialog.

## Save Reusable Container Template

Add an API route that:

- accepts a local image reference and display metadata
- persists a reusable user container template
- returns the saved template entry in the same shape the catalog/devices UI already understands

This route should not pull images by itself; image acquisition and template creation should remain separate operations even if the UI chains them.

## Create One-Off Node

Add an API route or reuse the existing lab-node create route with an image-backed container payload so the UI can:

- pick an active lab
- create a container node directly from the chosen image
- place it onto the canvas using the existing add-node positioning logic

## Devices Tab Integration

Saved reusable container templates should appear in `Devices`.

That means the template registry and catalog assembly need to merge:

- built-in templates
- persisted user container templates
- image-bound qemu templates
- built-in cloud templates

without reintroducing unbound qemu clutter.

## Testing Strategy

### API

Add tests for:

- runtime detection fallback order
- local image listing
- Docker Hub default search requests
- direct pull by image reference
- reusable container template persistence
- one-off container node creation

### Web

Add tests for:

- `Containers` tab rendering
- local image list flow
- search/pull flow
- default action being `Save as reusable template`
- one-off create being blocked when no active lab exists
- saved template appearing in `Devices`

## Risks And Constraints

- Container runtime CLIs differ in output shape, so normalization needs a narrow, controlled parsing layer.
- Registry search APIs vary across providers, so the first implementation should isolate provider-specific logic behind a small service boundary.
- User-defined templates should not be wedged into the built-in template override store; that would make later container-specific features harder.
- One-off node creation must avoid introducing hidden template persistence.

## Recommended Implementation Shape

Split this into four bounded areas:

- container runtime service
  - detect engine
  - list local images
  - pull images
  - search registries
- user container template store
  - persist reusable templates
  - merge them into template registry output
- API routes
  - container runtime/search/pull/template/node endpoints
- web UI
  - new Containers tab
  - action dialog
  - Devices integration for saved reusable templates

This keeps the image-discovery logic, persistence, and UI concerns separate enough to extend later.
