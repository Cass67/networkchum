# Changelog

## Unreleased

### Changed

- Development dependencies refreshed so `npm audit` is clean for all
  dependencies, not just runtime: vitest 3 → 4.1.12 (drops the `tinypool`
  critical advisories and the `@vitest/mocker` moderate ones), tsx → 4.23.15
  and the web Vite → 7.3.7 (esbuild 0.28.2), with `@testing-library/dom`
  declared explicitly because vitest 4 no longer hoists it.

## 0.1.0 — 2026-10-24

### Added

- **AI Lab Builder**: point the lab at an LLM (OpenAI-compatible endpoint or
  Anthropic) and describe a lab in plain English; a network-engineer system
  prompt with the live device catalog makes the model emit a constrained
  `AiLabSpec` JSON, the API resolves it against the catalog, clamps resources,
  and validates the full `LabDocument` before a preview/commit two-step
  creates the lab (`POST /ai/provider`, `/ai/labs/preview`, `/ai/labs/commit`;
  provider keys stored in the data dir, never returned to the browser;
  "Build with AI" in the Labs panel; endpoint model lists are detected
  automatically (`POST /ai/provider/probe`); qemu nodes use the host-detected
  acceleration like the Add Node flow; the dialog supports hand-picking
  devices so the AI wires only those; dialogs get a solid `.dialog` base
  (the canvas no longer bleeds through); **device config generation**: the
  spec can carry full day-0 startup configs — saved into an active config
  set with inject-once boot actions, covering Cisco IOSv/CSR 1000v
  (vfat day-0 disks), Arista vEOS (flash overlay), and Juniper vMX/vRR/cRPD
  (new `junos-config-disk` injector, Juniper make-config.sh convention);
  extended to IOS-XR CVAC (XRv/XRv9k), NX-OS CVAC (nxosv), Juniper vSRX
  bootstrap ISO, FortiGate config drive, and VyOS cloud-init seed; unsupported
  platforms are flagged in the preview; see `docs/agent-builder.md`)
- **Lab interconnect**: a Lab Bridge node in each lab merges the cabled
  networks into one broadcast domain across labs (mutual peer references;
  management uplink networks excluded; qemu VMs over the socket virtual
  switch)
- MIT license; `package.json` declares license, version, and Node engine range
- CI workflow: lockfile sync check, full test suite, and build on push/PR
- API token authentication: `serve`/`install-service` generate a 256-bit token
  in the data directory, the API rejects unauthenticated requests (all routes
  except `/health`), and the web UI prompts once and stores the token per
  browser; an **API Token** control replaces it on demand
- `SECURITY.md` documenting the token model and LAN exposure
- Freeform shape resizing (square/circle aspect lock removed)
- Copy/paste for canvas drawings via `Cmd/Ctrl+C` / `Cmd/Ctrl+V` and the
  right-click context menu

### Changed

- Running VMs survive lab switching and service restarts: the systemd unit uses
  `KillMode=none` with an `ExecStop` hook that stops only the API/web
  processes, and `uninstall-service` tears VMs down explicitly
- `install-service` pre-creates the data directory, hands it to the service
  user, verifies passwordless `ip` before granting, and preserves the installed
  unit's socket-networking mode on non-interactive reinstalls
- Neon icon theme: bodies render as pure glowing outlines (no dark fill box),
  glow softened, and the glyph viewport no longer clips the glow into a square
- Node icons render larger by default with an icon-size slider on the canvas
- Visio icon theme renamed to **Default Icons**

### Fixed

- Lab backup snapshot failures no longer fail the lab mutation that produced
  them (root-owned data directories were breaking every mutation with
  `EACCES`)
- Node icons no longer render a dark square behind them in the neon theme
- Runtime dependency advisories patched: `fastify` 5.12.7, `ws` 8.22.0 and
  `zod` 4.6.7 (`npm audit --omit=dev` now reports 0 vulnerabilities)
