# NetworkChum

NetworkChum is a browser-based network lab workbench for building and operating small topologies with QEMU-backed virtual devices and container nodes.

The project is aimed at an EVE-NG / PNETLab style workflow, but with a JSON-native lab model, a simple local API, and a cleaner split between topology state, image management, and runtime orchestration.

## What It Does Today

- Create, open, and delete labs from the web UI
- Add nodes from a device catalog
- Drag nodes around a topology canvas
- Create and remove Ethernet links between interfaces
- Power nodes on and off
- Open serial console sessions for running QEMU nodes
- Upload VM images, bind them to built-in templates, unbind them, or remove them from the active catalog
- Persist labs, runtime state, and image metadata in local JSON files
- Toggle between day and night themes in the web UI

## Repo Layout

- `apps/api`
  - Fastify API for labs, catalog, images, runtime, and console transport
- `apps/web`
  - React + Vite operator UI
- `packages/shared`
  - Shared Zod schemas and TypeScript types for topology and catalog data
- `docs`
  - Design and implementation notes from the current buildout

## Architecture At A Glance

NetworkChum stores each lab as a JSON document with:

- `nodes`
- `networks`
- `attachments`

The backend treats runtime as a separate concern from topology:

- topology changes update the lab document
- power actions create or stop runtime state
- image records are stored separately from lab documents

That separation keeps the UI simple and makes it easier to evolve runtime orchestration without rewriting the topology model.

## Built-In Templates

The current template library includes:

- Linux Generic VM
- Cisco ASR
- Cisco NX-OSv
- Juniper vSRX
- Arista vEOS
- Alpine Container
- Ubuntu Container
- Nettools Container

VM templates become directly usable once a `qcow2` image is bound to them. Container templates are usable immediately.

## Requirements

For development:

- Node.js with `npm`
- a recent enough environment to run Vite, Fastify, TypeScript, and Vitest

For runtime features:

- `qemu-system-x86_64` for VM nodes
- Docker for container nodes
- Linux `ip` tooling for TAP/bridge networking on Linux hosts

Platform notes:

- Linux is the preferred runtime host. If `/dev/kvm` is available, the backend will use KVM acceleration.
- macOS is usable for API and UI development. If QEMU exposes `hvf`, NetworkChum will use it; otherwise it falls back to software emulation. Non-Linux hosts use socket-based networking instead of TAP.

## Getting Started

Install dependencies from the repo root:

```bash
npm install
```

Start the full stack:

```bash
npm run dev
```

That starts:

- the API on `http://127.0.0.1:4000`
- the web UI on `http://127.0.0.1:5173`

The Vite dev server proxies `/api` requests to the backend automatically.

If you already have a stale local dev server running, reset both processes with:

```bash
npm run dev:reset
```

You can also run each side separately:

```bash
npm run dev:api
npm run dev:web
```

## Data Storage

By default, the API stores local state under:

`apps/api/data`

That directory currently contains:

- `labs.json`
- `images.json`
- `runtime-states.json`
- `images/`
- `overlays/`

You can override the storage root with:

```bash
NETWORKCHUM_DATA_DIR=/path/to/data npm run dev:api
```

Important image behavior:

- images discovered by scan live under the configured images directory
- images uploaded through the UI are written under `images/uploads/`
- removing an image from the catalog does not delete the file from disk; it only marks the image as removed from active catalog use

## Image Workflow

There are two ways images enter the system:

1. Startup scan
   - when the API starts, it scans the data images directory if one exists
2. Browser upload
   - upload an image from the web UI
   - bind it to a VM template
   - it becomes usable in the device catalog

Catalog behavior today:

- bound VM images appear as `image-bound` catalog entries
- unbound VM templates still appear so you can target them during image upload/binding
- removed images stay visible in the image library, but not in the add-node catalog

## Useful Scripts

From the repo root:

```bash
npm run dev
npm run dev:api
npm run dev:web
npm run build
npm run test
```

Per workspace:

```bash
npm run build --workspace @networkchum/api
npm run build --workspace @networkchum/web
npm run test --workspace @networkchum/api
npm run test --workspace @networkchum/web
```

## API Surface

Key endpoints:

- `GET /health`
- `GET /templates`
- `GET /catalog`
- `GET /labs`
- `POST /labs`
- `GET /labs/:labId`
- `DELETE /labs/:labId`
- `POST /labs/:labId/nodes`
- `DELETE /labs/:labId/nodes/:nodeId`
- `POST /labs/:labId/networks`
- `DELETE /labs/:labId/networks/:networkId`
- `POST /labs/:labId/attachments`
- `DELETE /labs/:labId/attachments/:interfaceId`
- `PATCH /labs/:labId/nodes/:nodeId/position`
- `POST /labs/:labId/nodes/:nodeId/power-on`
- `POST /labs/:labId/nodes/:nodeId/power-off`
- `GET /labs/:labId/runtime`
- `GET /images`
- `POST /images/upload`
- `POST /images/:imageId/bind-template`
- `DELETE /images/:imageId/template-binding`
- `DELETE /images/:imageId`

Console access is exposed over WebSocket at:

- `GET /labs/:labId/nodes/:nodeId/console`

## Development Notes

- the web app uses React 19 and Vite
- the API uses Fastify with multipart uploads and WebSocket support
- shared schemas live in `packages/shared`
- the current persistence model is intentionally simple and file-backed

This project is still early-stage software. The current implementation is best suited for local development, prototyping, and operator workflow iteration rather than a hardened multi-user deployment.

## Verification

Typical verification commands:

```bash
npm run test
npm run build
```

For the web workspace specifically:

```bash
npm run test --workspace @networkchum/web
npm run build --workspace @networkchum/web
```

## Current Rough Edges

- single-host only
- no auth or multi-user model
- file-backed persistence instead of a database
- runtime behavior is much more Linux-friendly than macOS-friendly
- VM usability depends on supplying compatible `qcow2` images and having the required host binaries installed

## License

No license file is present in this repository yet.
