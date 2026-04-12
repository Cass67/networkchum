# NetworkChum Install Guide

This guide is for operators who want the best practical NetworkChum setup on macOS or Linux. It starts with the fastest path to a working app, then adds the optional installs that unlock VM nodes, container nodes, native console launch, and better performance.

NetworkChum runs best on Linux. macOS works well for the UI, API, image management, and console workflows, but Linux is the stronger host for high-performance QEMU networking because it can use KVM and TAP devices.

## What You Get

| Capability                        | Required installs                                             |
| --------------------------------- | ------------------------------------------------------------- |
| Run the web UI and API            | Node.js, npm                                                  |
| Use VM nodes                      | QEMU (`qemu-system-x86_64`)                                   |
| Use container nodes               | Docker                                                        |
| Faster QEMU on Linux              | `/dev/kvm` access                                             |
| Native console launch from the UI | Native console bridge prerequisites plus a supported terminal |
| Better native console transport   | `socat` preferred, `nc` fallback                              |
| macOS URL-scheme helper           | AppleScript helper install                                    |

## Quick Start

If you only want the app running first:

1. Install `git`, Node.js 22+, and npm.
2. Clone the repo.
3. Install JavaScript dependencies.
4. Start the full stack.

Notes:

- `npm` is required because the repo uses `npm install` and `npm run ...` commands.
- On macOS and most standard Node.js installs, `npm` comes with Node.js.
- On some Linux distros, `nodejs` and `npm` are packaged separately, so install both when shown below.

If you want the repo to install the supported packages for you, use:

```bash
./install.sh
```

Useful installer modes:

- `./install.sh --dry-run` to preview the commands
- on Linux, the installer asks whether you want `podman` or `docker` unless you pass `--container-runtime=podman` or `--container-runtime=docker`
- on `dnf`-based Linux, the installer defaults to `podman` and installs `podman-docker` so the app can keep using the `docker` CLI

```bash
git clone <your-repo-url>
cd networkchum
npm install
npm run dev
```

That starts:

- the API at `http://127.0.0.1:4000`
- the web UI at `http://127.0.0.1:5173`
- the native console bridge at `http://127.0.0.1:4010`

At this point you can use the UI, create labs, add nodes, manage images, and work with whatever runtime features your host supports. To get the most out of the app, continue with the platform-specific setup below.

## macOS Setup

### Baseline install

Recommended baseline:

- Homebrew
- Node.js 22+ (includes `npm`)
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

NetworkChum expects `qemu-system-x86_64` for VM-backed devices.

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
- Non-Linux hosts use socket-backed networking rather than TAP devices.

### Install Docker for container nodes

Container templates need Docker.

Install Docker Desktop and verify:

```bash
docker version
docker info
```

If Docker is not installed or not running, container nodes will not power on.

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
- Docker Desktop
- `socat`
- iTerm
- the optional macOS helper

Even then, Linux remains the better host for serious QEMU lab runtime performance.

## Linux Setup

### Baseline install

Install:

- Node.js 22+
- npm
- Git
- `curl`

On Linux, many package managers split Node.js and npm into separate packages, so install both as shown in the examples.

Examples:

Ubuntu or Debian:

```bash
sudo apt update
sudo apt install -y nodejs npm git curl
```

Fedora:

```bash
sudo dnf install -y nodejs npm git curl
```

Arch:

```bash
sudo pacman -S --needed nodejs npm git curl
```

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
qemu-system-x86_64 --version
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

### Install Docker for container nodes

Install Docker Engine or Docker Desktop for Linux.

Ubuntu or Debian example:

```bash
sudo apt install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Fedora example:

```bash
sudo dnf install -y docker
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

### `qemu-system-x86_64` not found

Install QEMU. VM nodes will not start without it.

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

## Optional Advanced Tooling

If you also want to contribute to the repo rather than only operate the app, see [LOCAL_TOOLING.md](/Users/cass/git/networkchum/LOCAL_TOOLING.md) for pre-commit and local validation tooling.
