# Changelog

## Unreleased

### Added

- **VNC consoles** for templates that boot with a graphical console (FTD,
  ISE, PAN-OS, vQFX-PFE): QEMU gets `-vnc 127.0.0.1:5900+n`, the API proxies
  RFB over the same authenticated WebSocket pattern as the serial console, and
  the UI opens a noVNC viewer automatically when a node reports a VNC port.
- **Extra data disks** per template (`boot.dataDisks`), attached on the main
  disk bus. F5 BIG-IP now gets its 100 GB datastore disk.

### Changed

- **Cisco NX-OSv 9000** boots with Cisco's recipe: i440fx, UEFI (OVMF) and a
  SATA disk on an AHCI controller, 2 vCPU. SeaBIOS and virtio/IDE do not boot
  this image.
- **Cisco Catalyst 8000v** defaults to the 8 GB image size (8192 MB, 2 vCPU).
- **Cisco ISE** defaults to 16 GB, the ISE 3.x minimum.
- **Juniper vQFX** halves use IDE disks, matching EVE-NG's `hda` convention.

## 0.1.3 — 2026-11-03

### Added

- **Provider registry with a grouped picker**: subscriptions (ChatGPT,
  OpenCode Go), API keys (OpenAI, Anthropic, OpenRouter, Groq, DeepSeek, xAI,
  Moonshot, Mistral, Together, custom OpenAI-compatible) and local servers
  (Ollama, LM Studio). Each entry declares its wire protocol and default base
  URL, so adding a provider is a data change.
- **ChatGPT (Plus/Pro) sign-in**: OpenAI's device-code flow, the Codex
  `responses` protocol, `chatgpt-account-id` from the JWT, and SSE parsing of
  `response.output_text.delta` / `response.completed`.
- **OpenCode Go provider**: `https://opencode.ai/inference/go/openai/v1`
  (OpenAI-compatible), with the public Go model catalog at
  `https://opencode.ai/inference/go/v1/models`. Works with an `oc_sk_…` API key
  or an OpenCode Console sign-in.
- **Subscription credentials** live in `ai-oauth.json` (mode 0600), refresh
  five minutes before expiry, and are injected as the Bearer token at call
  time; the dialog shows the signed-in account and can sign out.

### Fixed

- **Provider credentials are no longer world-readable**: `ai-provider.json` is
  written with mode `0600` (and chmod'ed on save), matching the API token.
- A slow provider-settings load no longer overwrites a provider the user
  already switched while the request was in flight.

## 0.1.2 — 2026-11-03

### Fixed

- `install.sh` installs the `libatomic` runtime package on Linux: the official
  Node.js 26 x64 build links `libatomic.so.1`, which minimal cloud images omit,
  so `node` failed with a loader error before `npm install`

### Changed

- Node.js 26 (LTS "Lithium") is now the default runtime: `install.sh`
  installs the latest 26.x line, `engines` requires `>=26`, and CI tests 26
  only. Set `NETWORKCHUM_NODE_MAJOR=24` to install the previous line instead.

## 0.1.1 — 2026-11-03

### Added

- openSUSE Leap and SLES support in `install.sh` (`zypper` branch:
  `qemu-x86`, `qemu-tools`, podman/docker) plus `--package-manager=zypper`
- `scripts/vm-install-test.sh`: boot a cloud image in QEMU/KVM, run the
  installer end to end, and verify build, service, `/health`, and uninstall,
  so the platform matrix is repeatable

### Fixed

- **RHEL family:** prefer `docker-ce`, fall back to `moby-engine`, then the
  `podman-docker` shim, because `moby-engine`/`docker-cli` do not exist on
  Rocky/Alma; install `qemu-system-x86_64` from `qemu-kvm-core`; skip
  `systemctl enable docker` and the `docker` group when only the shim is
  installed
- **dnf:** probe available packages with `dnf list --available` instead of
  `dnf info`, which only reports installed ones and always picked `qemu-kvm`
- **Arch:** pass `--noconfirm` to `pacman` so the non-interactive install no
  longer aborts on a prompt
- **Arch/openSUSE:** a docker daemon that fails to start no longer aborts the
  whole install under `set -e`
- **Web tests:** fall back to an in-memory `localStorage` when Node's global
  shadows jsdom's, so the token test passes on Node >= 25

### Changed

- Development dependencies refreshed so `npm audit` is clean for all
  dependencies, not just runtime: vitest 3 → 4.1.12 (drops the `tinypool`
  critical advisories and the `@vitest/mocker` moderate ones), tsx → 4.23.15
  and the web Vite → 7.3.7 (esbuild 0.28.2), with `@testing-library/dom`
  declared explicitly because vitest 4 no longer hoists it.
- CI runs the suite on Node 22 and 24

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
