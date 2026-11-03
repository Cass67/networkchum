# NetworkChum Install Guide

This guide is for operators who want the best practical NetworkChum setup on macOS or Linux. It starts with the fastest path to a working app, then adds the optional installs that unlock VM nodes, container nodes, native console launch, and better performance.

NetworkChum runs best on Linux. macOS works well for the UI, API, image management, and console workflows, but Linux is the stronger host for high-performance QEMU networking because it can use KVM and TAP devices.

## What You Get

| Capability                        | Required installs                                                   |
| --------------------------------- | ------------------------------------------------------------------- |
| Run the web UI and API            | Node.js, npm                                                        |
| Use VM nodes                      | QEMU (`qemu-system-x86_64`, `qemu-kvm`, or `/usr/libexec/qemu-kvm`) |
| Use container nodes               | Podman or Docker                                                    |
| Faster QEMU on Linux              | `/dev/kvm` access                                                   |
| Native console launch from the UI | Native console bridge prerequisites plus a supported terminal       |
| Better native console transport   | `socat` preferred, `nc` fallback                                    |
| macOS URL-scheme helper           | AppleScript helper install                                          |

## Download A Release

Tagged releases publish `networkchum-<version>.tar.gz` and `SHA256SUMS` on the
GitHub Releases page:

```bash
VERSION=1.0.0
curl -LO "https://github.com/Cass67/networkchum/releases/download/v${VERSION}/networkchum-${VERSION}.tar.gz"
curl -LO "https://github.com/Cass67/networkchum/releases/download/v${VERSION}/SHA256SUMS"
sha256sum -c SHA256SUMS
tar -xzf "networkchum-${VERSION}.tar.gz"
cd "networkchum-${VERSION}"
./install.sh
```

## Remote Clients

The web UI (serial and VNC consoles) works from any browser on the LAN with no
client install. The optional native console needs the console bridge on the
client machine: download `networkchum-console-bridge-<version>.tar.gz` from the
Releases page and run `./run.sh` or `run.cmd` (Node.js 22+). On a remote server
the bridge uses an SSH relay, so the client needs an SSH client and the server
needs `socat` or `nc`.

## Quick Start

If you only want the app running first:

1. Install `git` and a current Node.js LTS release.
2. Clone the repo.
3. Install JavaScript dependencies.
4. Start the full stack.

Notes:

- `npm` is required because the repo uses `npm install` and `npm run ...` commands.
- `npm` comes with the official Node.js installers and archives.
- On Linux, prefer the official Node.js distribution instead of distro `nodejs` packages if you want a predictable modern runtime.

If you want the repo to install the supported packages for you, use:

```bash
./install.sh
```

Useful installer modes:

- `./install.sh --dry-run` to preview the commands
- on Linux, the installer asks whether you want `podman` or `docker` unless you pass `--container-runtime=podman` or `--container-runtime=docker`
- on Linux, the installer downloads Node.js directly from `nodejs.org` instead of using distro `nodejs` packages
- on Linux, if `firewalld` or `ufw` is detected, the installer can prompt to open `4000/tcp` and `5173/tcp` for `./start.sh lan`
- use `--open-firewall` or `--skip-firewall` to answer that firewall step non-interactively
- set `NETWORKCHUM_NODE_MAJOR=24` if you want the Node.js 24.x line instead of the default 26.x line
- on `dnf`-based Linux, the installer defaults to `podman` and installs `podman-docker` so the app can keep using the `docker` CLI

Useful start modes:

- `./start.sh` keeps the app on localhost
- `./start.sh lan` binds the web UI and API for LAN access
- `./start.sh lan --sudo-api` runs the API with `sudo` on Linux so TAP/bridge labs can start while keeping the web UI on LAN
- `NETWORKCHUM_BIND_MODE=lan npm run dev` is the direct env-based equivalent

```bash
git clone <your-repo-url>
cd networkchum
npm install
./start.sh
```

For LAN access on Linux:

```bash
./start.sh lan
```

If the host has `firewalld` or `ufw`, either let `./install.sh` open `4000/tcp` and `5173/tcp` for you or add those rules yourself.

If you want Linux VM labs that use TAP networking, start with:

```bash
./start.sh lan --sudo-api --data-dir ~/networkchum-data
```

That keeps the web UI and native console bridge unprivileged, but starts the API with the privileges needed for bridge and TAP device management.

For Linux management-cloud access:

- do not point a cloud node at the host's active physical NIC directly
- create a cloud node with `Cloud Role = Management`
- use bridge group `management` unless you intentionally want a different shared segment
- start with `./start.sh lan --sudo-api ...` so the API can create TAP devices and managed bridges
- if you want that managed bridge tied to a physical uplink, do that on the host OS rather than by binding a cloud directly to the active NIC

That starts:

- the API at `http://127.0.0.1:4000`
- the web UI at `http://127.0.0.1:5173`
- the native console bridge at `http://127.0.0.1:4010`

In `lan` mode, the web UI and API bind for LAN access and the script prints the server URL to open from another machine.

At this point you can use the UI, create labs, add nodes, manage VM images,
and work with whatever runtime features your host supports. The `Containers`
tab lets you inspect local OCI images, search Docker Hub by default, pull
direct refs such as `oraclelinux:9-slim`, save reusable container templates,
and create one-off container nodes in the active lab. To get the most out of
the app, continue with the platform-specific setup below.

## macOS Setup

### Baseline install

Recommended baseline:

- Homebrew
- Node.js 26 LTS recommended (`npm` included)
- Git

Example:

```bash
brew install node git
```

Verify:

```bash
node --version
npm --version
git --version
```

### Install QEMU for VM nodes

On macOS, the Homebrew QEMU install provides `qemu-system-x86_64`.

```bash
brew install qemu
```

Verify:

```bash
qemu-system-x86_64 --version
qemu-system-x86_64 -accel help
```

What to expect:

- On Intel or Apple Silicon macOS, NetworkChum will use `hvf` acceleration if QEMU exposes it.
- If `hvf` is unavailable, the app falls back to software emulation (`tcg`), which is usable for experimentation but slow for heavier VM workloads.
- Non-management clouds on macOS stay socket-backed rather than using TAP devices.

### macOS management clouds

Management clouds on macOS do not require Podman or Docker. They use the app's host-only management backend instead of Linux TAP bridging.

What to expect:

- the management subnet is fixed at `172.31.255.0/24`
- the Mac host uses `172.31.255.1`
- give nodes static management IPs in that subnet
- SSH from the Mac host directly to those node IPs once the node is configured
- this is host-only management, not LAN-wide bridging
- private-circuit and ISP-carrier clouds on macOS still use the existing isolated socket-backed behavior

### Install a container runtime for container nodes

NetworkChum prefers `podman` when both runtimes are installed and falls back to
`docker` otherwise.

Install either runtime and verify the CLI works:

```bash
podman version
# or
docker version
```

If neither runtime is installed or running, the `Containers` tab will show the
runtime as unavailable and container nodes will not power on.

### Install native console helpers

The app can open consoles in native terminals instead of only using the in-browser xterm view.

Recommended macOS tools:

- `socat`
- `iTerm` or `Terminal.app`

Install `socat`:

```bash
brew install socat
```

Why it helps:

- the native console bridge prefers `socat`
- if `socat` is not available, it falls back to `/usr/bin/nc`

Install a terminal app:

- `Terminal.app` is built in
- `iTerm` is optional but works directly with the bridge

Optional:

```bash
brew install --cask iterm2
```

### Install the macOS console helper

If you want the URL-scheme helper flow, install the bundled helper app:

```bash
chmod +x scripts/install-networkchum-native-console-helper.sh
./scripts/install-networkchum-native-console-helper.sh
```

This installs `NetworkChum Console Helper.app` into `$HOME/Applications` and registers the `networkchum://` URL scheme.

Verify:

```bash
open 'networkchum://open-console?terminal=iterm&host=127.0.0.1&port=5004'
```

Expected behavior:

- macOS routes the URL to the helper
- the helper launches iTerm
- iTerm opens a console command for the requested localhost port

### Best macOS experience

For the strongest macOS operator setup, install:

- Node.js
- Git
- QEMU
- Podman or Docker if you plan to run container nodes
- `socat`
- iTerm
- the optional macOS helper

Even then, Linux remains the better host for serious QEMU lab runtime performance and for LAN-facing bridge workflows.

## Linux Setup

### Baseline install

Install:

- Git
- `curl`
- CA certificates
- `xz`
- an official Node.js release from `nodejs.org`
- QEMU for x86 VMs (`qemu-system-x86_64`, `qemu-kvm`, or `/usr/libexec/qemu-kvm`)

On Linux, the recommended path is to use the official Node.js release archive rather than distro `nodejs` and `npm` packages. That avoids landing on older distro-maintained Node releases.

Examples:

Ubuntu or Debian:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates xz-utils
```

RHEL, Oracle Linux, Fedora, or other `dnf`-based distros:

```bash
sudo dnf install -y git curl ca-certificates xz
```

Arch:

```bash
sudo pacman -S --needed git curl ca-certificates xz
```

openSUSE or SLES:

```bash
sudo zypper install git curl ca-certificates xz
```

`./install.sh` supports these families: `apt` (Debian, Ubuntu), `dnf` (Fedora,
RHEL, CentOS Stream, Rocky, Alma, Oracle Linux), `pacman` (Arch), and `zypper`
(openSUSE, SLES), plus Homebrew on macOS. Each of the Linux families is
exercised by booting a cloud image, running the installer, building, installing
the service and checking `/health`; see `scripts/vm-install-test.sh`.

Recommended Node.js install on Linux:

```bash
./install.sh
```

That installs the latest Node.js 26.x build from `nodejs.org` by default. If you want the 24.x line instead:

```bash
NETWORKCHUM_NODE_MAJOR=24 ./install.sh
```

If you want to install Node.js manually from the official archive on Linux `x86_64`, the equivalent flow is:

```bash
curl -fsSL https://nodejs.org/download/release/latest-v26.x/SHASUMS256.txt -o /tmp/SHASUMS256.txt
NODE_TAR=$(awk '/linux-x64\.tar\.xz$/ { print $2; exit }' /tmp/SHASUMS256.txt)
curl -fsSL "https://nodejs.org/download/release/latest-v26.x/${NODE_TAR}" -o "/tmp/${NODE_TAR}"
grep " ${NODE_TAR}$" /tmp/SHASUMS256.txt | sha256sum -c -
sudo mkdir -p /usr/local/lib/nodejs
sudo tar -xJf "/tmp/${NODE_TAR}" -C /usr/local/lib/nodejs
sudo ln -sf "/usr/local/lib/nodejs/${NODE_TAR%.tar.xz}/bin/node" /usr/local/bin/node
sudo ln -sf "/usr/local/lib/nodejs/${NODE_TAR%.tar.xz}/bin/npm" /usr/local/bin/npm
sudo ln -sf "/usr/local/lib/nodejs/${NODE_TAR%.tar.xz}/bin/npx" /usr/local/bin/npx
sudo ln -sf "/usr/local/lib/nodejs/${NODE_TAR%.tar.xz}/bin/corepack" /usr/local/bin/corepack
```

On Linux `arm64`, change the archive match from `linux-x64` to `linux-arm64`.

The official Node.js 26 x64 archive links `libatomic.so.1`, which minimal
cloud images do not ship. Install it before running `node` (`libatomic1` on
Debian/Ubuntu and openSUSE, `libatomic` on Fedora/Rocky, `gcc-libs` on Arch);
`install.sh` adds it automatically.

Verify:

```bash
node --version
npm --version
git --version
```

### Install QEMU and Linux networking tools

For VM-backed nodes on Linux, install:

- QEMU
- `ip` tooling from `iproute2`

Ubuntu or Debian:

```bash
sudo apt install -y qemu-system-x86 qemu-utils iproute2
```

RHEL, Oracle Linux, Fedora, or other `dnf`-based distros:

```bash
sudo dnf install -y qemu-kvm qemu-img iproute
```

Arch:

```bash
sudo pacman -S --needed qemu-base qemu-desktop iproute2
```

NetworkChum uses the `ip` command for bridge and TAP setup, so `bridge-utils`/`brctl` is not required for the current runtime.

Verify:

```bash
qemu-system-x86_64 --version || qemu-kvm --version || /usr/libexec/qemu-kvm --version
ip -V
```

### Enable the best Linux VM performance

NetworkChum prefers Linux because it can use KVM acceleration and TAP networking.

Check for KVM:

```bash
ls -l /dev/kvm
```

If `/dev/kvm` exists, make sure your user can access it. That usually means:

- your CPU and BIOS/UEFI virtualization settings are enabled
- the KVM kernel modules are loaded
- your user is in the correct group for your distro, often `kvm`

Common step:

```bash
sudo usermod -aG kvm "$USER"
```

Then log out and back in before retrying.

Why this matters:

- with `/dev/kvm`, NetworkChum can use hardware acceleration
- Linux also uses TAP networking rather than the socket-based fallback used on macOS and other non-Linux hosts

For Linux TAP labs, the API process also needs permission to create and delete bridge/TAP devices. The supported development path is `./start.sh lan --sudo-api ...`, which runs only the API under `sudo`.

If you do not want to type a sudo password every time, add a constrained `sudoers` rule for the exact API launch command that `start.sh` uses on that host.

Generate it first:

```bash
./start.sh --dry-run lan --sudo-api --data-dir ~/networkchum-data
```

That prints a `sudo -n env PATH=... /path/to/npm run dev:api` command. Copy only that API command shape into `visudo` and grant `NOPASSWD` for that exact command.

Example only, adjust it to match your dry-run output exactly:

```sudoers
cass ALL=(root) NOPASSWD:SETENV: /usr/bin/env PATH=/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin NETWORKCHUM_BIND_MODE=lan NETWORKCHUM_DATA_DIR=/home/cass/networkchum-data /usr/local/bin/npm run dev:api
```

Guidelines:

- keep the rule exact and host-specific
- do not allow a generic `npm`, `node`, `sh`, or `bash` sudo rule
- keep the approved data directory fixed if you want the narrowest rule
- always edit sudoers with `visudo`

### Install a container runtime for container nodes

Install a Linux container runtime.

On `dnf`-based systems, Podman is usually the better default. NetworkChum can use it through `podman-docker`, which keeps the `docker` CLI name available for the app.

Ubuntu or Debian example:

```bash
sudo apt install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Fedora example:

```bash
sudo dnf install -y podman podman-docker
```

Verify:

```bash
podman --version
docker --version
```

If you specifically want Docker Engine on `dnf`-based Linux:

```bash
sudo dnf install -y moby-engine docker-cli
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Arch example:

```bash
sudo pacman -S --needed docker
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Then log out and back in, and verify:

```bash
docker version
docker info
```

### Install native console bridge prerequisites

The Linux native console bridge needs a supported terminal launcher. The bridge tries these in order:

- `x-terminal-emulator`
- `gnome-terminal`
- `konsole`
- `xfce4-terminal`
- `xterm`

Install at least one of them.

Examples:

Ubuntu or Debian:

```bash
sudo apt install -y xterm
```

Fedora:

```bash
sudo dnf install -y xterm
```

Arch:

```bash
sudo pacman -S --needed xterm
```

Recommended extra:

```bash
sudo <your-package-manager> install socat
```

For example:

- Ubuntu or Debian: `sudo apt install -y socat`
- Fedora: `sudo dnf install -y socat`
- Arch: `sudo pacman -S --needed socat`

If `socat` is unavailable, the bridge falls back to `nc`.

### Best Linux experience

For the strongest Linux operator setup, install:

- Node.js
- Git
- QEMU
- `iproute2`
- Docker
- `socat`
- at least one supported terminal launcher
- KVM access for your user

That is the best way to get the full app: VM nodes, container nodes, native consoles, faster startup, and the Linux-preferred network backend.

## Get The Most Out Of It

### Supply real `qcow2` images

Built-in VM templates become genuinely useful only after you bind compatible disk images.

Ways to make this work well:

- keep your VM images in the API data images directory so startup scan can find them
- or upload images through the browser UI
- bind each image to the correct built-in template

The app scans for `qcow2` images and can suggest a template from the filename, but the operator is still responsible for providing compatible images.

### Put persistent data somewhere intentional

By default, NetworkChum stores runtime data under `apps/api/data`.

If you want your labs and images in a dedicated location:

```bash
NETWORKCHUM_DATA_DIR=/path/to/networkchum-data npm run dev:api
```

Equivalent with the root start script:

```bash
./start.sh localhost dev:api --data-dir /path/to/networkchum-data
```

You can combine that with LAN mode as well:

```bash
./start.sh lan dev:api --data-dir /path/to/networkchum-data
```

This is useful if you want:

- larger/faster storage for uploaded images and overlays
- easier backups
- a cleaner separation between code and runtime data

### Use the native console bridge

`npm run dev` starts the native console bridge automatically. If needed, you can run it by itself:

```bash
./scripts/run-native-console-bridge.sh
```

Verify:

```bash
curl -s http://127.0.0.1:4010/health
```

You should see:

```json
{ "ok": true }
```

If the bridge is unavailable, the app still supports:

- the in-browser web console
- copy-command workflows for native terminal use

When you open the UI from another machine over the LAN, prefer the in-browser web console. Native terminal launch remains a local-machine workflow.

### Understand host expectations

To get the most value from the app:

- use Linux if VM runtime performance matters
- use macOS comfortably for UI work, image management, and lighter VM workflows
- make sure Docker is running before using container templates
- make sure QEMU is installed before expecting VM nodes to power on
- install `socat` if you want a better native console transport path

## Verification Checklist

After setup, verify each layer you care about.

### App baseline

```bash
npm install
npm run dev
```

Check:

- `http://127.0.0.1:5173` loads
- `http://127.0.0.1:4000/health` responds
- `http://127.0.0.1:4010/health` responds

### VM support

```bash
qemu-system-x86_64 --version
```

Check:

- the binary exists
- VM nodes can be added and powered on

### Container support

```bash
docker info
```

Check:

- Docker is running
- container templates can power on

### Linux acceleration

```bash
ls -l /dev/kvm
```

Check:

- `/dev/kvm` exists
- your user can access it

### Native console support

```bash
curl -s http://127.0.0.1:4010/health
```

Check:

- bridge health is `ok`
- opening a node console from the UI can launch your native terminal if configured

## Troubleshooting

### No supported QEMU binary found

Install QEMU. On Linux, NetworkChum auto-detects `qemu-system-x86_64`, `qemu-kvm`, and `/usr/libexec/qemu-kvm`.

### Docker nodes do not start

Install Docker and make sure the daemon is running. On Linux, also ensure your user has permission to use Docker.

### Native console bridge is offline

Start the full stack with:

```bash
npm run dev
```

Or launch the bridge directly:

```bash
./scripts/run-native-console-bridge.sh
```

### Linux native console launch fails

Install at least one supported terminal launcher such as `xterm`, `gnome-terminal`, `konsole`, or `xfce4-terminal`.

### macOS VMs are slow

That usually means QEMU is using software emulation instead of HVF. Verify:

```bash
qemu-system-x86_64 -accel help
```

If HVF is unavailable, macOS is still usable, but Linux with KVM is the better host for serious VM labs.

### Linux VM performance is poor

Check `/dev/kvm`, your user permissions, and whether virtualization is enabled in firmware.

### The app runs but VM templates are not useful

You likely still need to provide and bind real `qcow2` images. The built-in VM templates are not enough on their own.

## Service, Deploys, And Running Labs

- **Labs run concurrently.** Devices in one lab keep running while you open
  another lab in the UI; switching labs only changes what you are looking at.
  Closing a console never stops a device — reconnect any time.
- **Deploys do not stop running VMs.** The installed service uses
  `KillMode=none`, so `systemctl restart` (the deploy routine:
  `git pull && npm run build && systemctl --user restart`) leaves qemu VMs
  running; an `ExecStop` hook stops only the API/web processes. Consoles and
  network links re-attach on demand. `uninstall-service` is the exception — it
  tears running VMs down for real.
- **Containers** run via rootless `podman` as detached daemons and survive
  service restarts regardless.
- The service logs to `.networkchum/service.log`; `./start.sh logs` tails it.

## API Token

The API is token-gated: every route except `GET /health` requires the
`x-networkchum-token` header, and `serve`/`install-service` always configure
one.

- **Where it lives**: `<data-dir>/api-token` (mode `600`), generated on first
  serve. Delete the file and restart the service to rotate it — every browser
  must then re-authenticate.
- **Retrieve it**: `./start.sh doctor` prints it (plus a data-dir writability
  check). On a remote host:
  `ssh <host> 'cd ~/networkchum && ./start.sh doctor'`.
- **In the browser**: the first rejected request pops the **API Token** dialog —
  paste the token once; it is stored in that browser's `localStorage`. To
  replace it later, use the **API Token** button in the canvas controls bar, or
  `localStorage.removeItem("networkchum-api-token"); location.reload()` and the
  dialog re-appears.
- **Loopback dev**: `./start.sh dev` on localhost runs without a token.

See [SECURITY.md](SECURITY.md) for the full model.

## Optional Advanced Tooling

If you also want to contribute to the repo rather than only operate the app,
the pre-commit and local validation tooling is declared in
`.pre-commit-config.yaml`; run `pre-commit install` once after cloning.
