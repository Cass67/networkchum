# Contributing

## Getting started

```bash
git clone <repo> && cd networkchum
npm install
npm run dev        # API :4000, UI :5173, native console bridge :4010
```

On macOS you also need QEMU (`brew install qemu`) and a container runtime.

## Working on the app

- `apps/api` — Fastify backend (labs, runtime, networking, templates)
- `apps/web` — React UI (topology canvas, dialogs, consoles)
- `packages/shared` — types shared between API and UI
- `scripts` — `start.sh` + tested helpers (doctor, systemd unit, serve-web)
- `tools/native-console-bridge` — localhost terminal launcher sidecar

## Before you push

```bash
npm test            # vitest suites + scripts/*.test.mjs + bridge tests
npm run build       # all workspaces
```

CI runs the same on every push and PR, and fails if `package-lock.json` is out
of sync with `package.json` — regenerate with `npm install --package-lock-only`
and commit the lock rather than fighting it.

Pre-commit hooks (lint, format, gitleaks, shellcheck, `tsc --noEmit`) install
with `pre-commit install`.

## Conventions

- One concern per commit; keep the diff boring
- New behavior gets a test next to the code it changes
- Never commit tokens, keys, or host-specific deployment details; the deploy
  routine lives in git-ignored files
