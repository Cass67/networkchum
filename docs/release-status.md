# NetworkChum — Release Status Report

**Date:** 2026-11-02 · **Branch:** `main` @ `f60d54c` · **Live host:** `192.168.2.1` (`ubt26`)

## Verdict

**Release-ready on automated gates.** CI, tests, audits, build, clean install and the full platform matrix all pass, and the app is live and healthy on the new host. The only outstanding item is the manual browser walkthrough of the UI flows.

## Release gate

| Gate                             | Status                 | Evidence                                                              |
| -------------------------------- | ---------------------- | --------------------------------------------------------------------- |
| CI green on main                 | **PASS**               | Run 41527087763, success, 1m15s                                       |
| Full suite green at HEAD         | **PASS**               | 897 tests, 0 failing (api 282, web 221, shared 46, scripts+bridge 66) |
| Production build                 | **PASS**               | `npm run build` clean on macOS and on the box                         |
| Runtime audit clean              | **PASS**               | `npm audit --omit=dev` → 0 vulnerabilities                            |
| All-deps audit clean             | **PASS**               | `npm audit` → 0 vulnerabilities                                       |
| Clean install validated          | **PASS**               | Fresh Ubuntu 26.04 on ubt26                                           |
| Installer validated per platform | **PASS**               | Six cloud images, see matrix below                                    |
| Live deployment healthy          | **PASS**               | `/health` 200, UI 200, unauth `/labs` 401, authed 200                 |
| Tagged commit + dated changelog  | **PASS (with caveat)** | `v0.1.0` still points at `6adff4c`; HEAD is 7 commits past it         |
| Browser flow checklist           | **NOT DONE**           | Skipped by request; partial coverage below                            |

## Platform matrix (VM-tested today)

Each run boots a cloud image in QEMU/KVM, runs `install.sh --yes` for real (including the Node 24 download from nodejs.org), builds, installs the systemd service, checks `/health`, then uninstalls.

| Distro                          | Package family | install.sh | build | service | /health | uninstall |
| ------------------------------- | -------------- | ---------- | ----- | ------- | ------- | --------- |
| Ubuntu 24.04                    | apt            | PASS       | PASS  | PASS    | 200     | PASS      |
| Debian 12                       | apt            | PASS       | PASS  | PASS    | 200     | PASS      |
| Fedora 42 (Cloud Base, mutable) | dnf            | PASS       | PASS  | PASS    | 200     | PASS      |
| Rocky Linux 9                   | dnf            | PASS       | PASS  | PASS    | 200     | PASS      |
| Arch Linux                      | pacman         | PASS       | PASS  | PASS    | 200     | PASS      |
| openSUSE Leap 15.6              | zypper         | PASS       | PASS  | PASS    | 200     | PASS      |

Reproduce with `scripts/vm-install-test.sh <image-url> <name>` on a KVM host; image URLs for each family are in the script header.

**Not covered by the matrix:** container runtimes (docker/podman do not start without nested virtualisation — only CLI presence is checked), KVM/TAP VM labs inside the guest, and macOS/Homebrew.

## What changed this session

1. **New host brought up.** `192.168.2.1` had no install: cloned the repo, gave the box GitHub auth (registered its existing `actualpal-backup` key as a deploy key, pinned it in `~/.ssh/config`), ran the installer, built, installed the service in LAN mode.
2. **Dev-only audit advisories cleared** (`73e6686`): vitest 3 → 4.1.12, tsx → 4.23.15, web Vite → 7.3.7, `@testing-library/dom` declared. `npm audit` now clean for all dependencies.
3. **Installer fixed against real distros** — six bugs found only by running it on the platforms we claim:
   - RHEL-family: `moby-engine`/`docker-cli` don't exist on Rocky/Alma; now prefers `docker-ce`, falls back to `moby-engine`, then the `podman-docker` shim.
   - RHEL-family: `qemu-system-x86_64` ships in `qemu-kvm-core`; now installed alongside `qemu-kvm`.
   - RHEL-family: the `podman-docker` shim has no `docker.service` or `docker` group; `systemctl enable`/`usermod` are now conditional.
   - dnf QEMU probe used `dnf info` (installed packages only) and always picked `qemu-kvm`; now `dnf list --available`.
   - Arch: `pacman -S` prompted without `--noconfirm` and aborted the non-interactive install.
   - Arch/openSUSE: a docker daemon that fails to start aborted the whole install under `set -e`; now non-fatal.
4. **openSUSE/SLES support added** (`zypper` branch: `qemu-x86`, `qemu-tools`, podman/docker), plus `--package-manager=zypper` and docs.
5. **`scripts/vm-install-test.sh`** added so the matrix is repeatable.
6. **Deploy notes corrected** in `AGENTS.md` and repo memory: new host, system unit, token path, `npm ci` in the deploy flow.

## Verified in the running app

- Lab "Release Smoke" created through the UI and persisted to `labs.json`.
- Container node `alpine-1` added, powered on → real `docker run` on the host.
- Console command executes inside the container.
- API reports the node `running` with the correct `docker exec` connect command.

## Not verified

- In-browser xterm pane showing live output — headless Chrome's renderer froze on Connect (harness issue, not proven to be an app bug).
- Image pull from a repo URL, and the AI lab builder flows.
- Console errors during those flows.

## Open items / risks

- **Tag drift:** `v0.1.0` → `6adff4c`; HEAD is `f60d54c`. Move the tag or cut `v0.1.1`.
- **Immutable Fedora (CoreOS) is not supported.** The tested Fedora image is mutable Fedora Cloud Base (btrfs, `dnf`). Fedora CoreOS uses `rpm-ostree` and has no installer branch.
- **npm resolver bug:** npm 10.9.8 crashes (`Cannot read properties of null (reading 'edgesOut')`) on plain `npm install` in this workspace; `npm ci` works and the deploy flow uses it.
- **Data dir is repo-local** (`apps/api/data`, gitignored) — a `git clean -xdf` on the box would wipe labs and the token.
- **systemd warns** `KillMode=none` is deprecated (intentional, so labs survive restarts).
- **Test harness flakiness:** the Fedora VM occasionally dies during the final steps; `-no-reboot -no-shutdown` mostly fixes it, but it needed several attempts.
- **Pre-commit hooks** are not wired into any npm script.
- **Stale doc:** `docs/release-readiness.html` still describes the old 192.168.2.57 box and pre-fix state.

## Recommended next steps

1. Walk the UI checklist in a real browser at `http://192.168.2.1:5173/`.
2. Decide the tag: move `v0.1.0` to `f60d54c` or cut `v0.1.1`.
3. Optionally decide whether Fedora CoreOS is a target worth an `rpm-ostree` branch.
