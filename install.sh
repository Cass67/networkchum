#!/bin/sh
set -eu

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)
export PATH="/usr/local/bin:$PATH"

DRY_RUN=0
ASSUME_YES=0
OS_OVERRIDE=""
PKG_MANAGER_OVERRIDE=""
CONTAINER_RUNTIME=""
FIREWALL_OVERRIDE="auto"
FIREWALL_ACTION=""
NODE_MAJOR=${NETWORKCHUM_NODE_MAJOR:-26}

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

current_user() {
  if [ -n "${SUDO_USER:-}" ]; then
    printf '%s\n' "$SUDO_USER"
    return
  fi

  if [ -n "${USER:-}" ]; then
    printf '%s\n' "$USER"
    return
  fi

  id -un
}

print_usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Installs the packages needed to get the most out of NetworkChum on macOS or Linux,
then runs npm install in the repo root.

Options:
  --dry-run                     Print the commands without running them
  --yes, -y                     Non-interactive mode; choose defaults automatically
  --os=macos|linux              Override detected OS
  --package-manager=brew|apt|dnf|pacman|zypper
                                Override detected package manager
  --container-runtime=podman|docker
                                Linux only; skip the runtime prompt
  --firewall=auto|firewalld|ufw|none
                                Linux only; override firewall detection
  --open-firewall               Linux only; open 4000/tcp and 5173/tcp
  --skip-firewall               Linux only; leave firewall rules unchanged
  --help, -h                    Show this help text

Environment:
  NETWORKCHUM_NODE_MAJOR        Linux only; Node.js release line to install
                                directly from nodejs.org (default: 26)
EOF
}

run_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run]'
    for arg in "$@"; do
      printf ' %s' "$arg"
    done
    printf '\n'
    return
  fi

  printf '+'
  for arg in "$@"; do
    printf ' %s' "$arg"
  done
  printf '\n'
  "$@"
}

detect_os() {
  if [ -n "$OS_OVERRIDE" ]; then
    printf '%s\n' "$OS_OVERRIDE"
    return
  fi

  case "$(uname -s)" in
    Darwin) printf '%s\n' "macos" ;;
    Linux) printf '%s\n' "linux" ;;
    *) die "unsupported operating system: $(uname -s)" ;;
  esac
}

detect_package_manager() {
  os_name=$1

  if [ -n "$PKG_MANAGER_OVERRIDE" ]; then
    printf '%s\n' "$PKG_MANAGER_OVERRIDE"
    return
  fi

  if [ "$os_name" = "macos" ]; then
    if have_cmd brew; then
      printf '%s\n' "brew"
      return
    fi
    die "Homebrew is required on macOS"
  fi

  if have_cmd apt-get; then
    printf '%s\n' "apt"
    return
  fi

  if have_cmd dnf; then
    printf '%s\n' "dnf"
    return
  fi

  if have_cmd pacman; then
    printf '%s\n' "pacman"
    return
  fi

  if have_cmd zypper; then
    printf '%s\n' "zypper"
    return
  fi

  die "could not detect a supported package manager"
}

ensure_supported_combo() {
  os_name=$1
  pkg_manager=$2

  case "$os_name:$pkg_manager" in
    macos:brew | linux:apt | linux:dnf | linux:pacman | linux:zypper) ;;
    *) die "unsupported OS/package manager combination: $os_name + $pkg_manager" ;;
  esac
}

choose_container_runtime() {
  pkg_manager=$1

  if [ -n "$CONTAINER_RUNTIME" ]; then
    printf '%s\n' "$CONTAINER_RUNTIME"
    return
  fi

  if have_cmd podman && ! have_cmd docker; then
    default_runtime="podman"
  elif have_cmd docker && ! have_cmd podman; then
    default_runtime="docker"
  elif [ "$pkg_manager" = "dnf" ]; then
    default_runtime="podman"
  elif [ "$pkg_manager" = "zypper" ]; then
    default_runtime="podman"
  else
    default_runtime="docker"
  fi

  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    printf '%s\n' "$default_runtime"
    return
  fi

  prompt="Choose Linux container runtime [podman/docker] (default: $default_runtime): "
  printf '%s' "$prompt" >/dev/tty
  if ! read -r answer </dev/tty; then
    answer=""
  fi

  case "$answer" in
    "")
      printf '%s\n' "$default_runtime"
      ;;
    podman | docker)
      printf '%s\n' "$answer"
      ;;
    *)
      die "invalid container runtime choice: $answer"
      ;;
  esac
}

detect_firewall() {
  case "$FIREWALL_OVERRIDE" in
    auto) ;;
    none)
      printf '%s\n' ""
      return
      ;;
    firewalld | ufw)
      printf '%s\n' "$FIREWALL_OVERRIDE"
      return
      ;;
    *)
      die "unsupported firewall override: $FIREWALL_OVERRIDE"
      ;;
  esac

  if have_cmd firewall-cmd; then
    printf '%s\n' "firewalld"
    return
  fi

  if have_cmd ufw; then
    printf '%s\n' "ufw"
    return
  fi

  printf '%s\n' ""
}

choose_firewall_action() {
  firewall_name=$1

  if [ -z "$firewall_name" ]; then
    if [ "$FIREWALL_ACTION" = "open" ]; then
      die "--open-firewall requires firewalld or ufw"
    fi
    printf '%s\n' "skip"
    return
  fi

  if [ -n "$FIREWALL_ACTION" ]; then
    printf '%s\n' "$FIREWALL_ACTION"
    return
  fi

  if [ "$ASSUME_YES" -eq 1 ] || [ ! -t 0 ]; then
    printf '%s\n' "skip"
    return
  fi

  prompt="Detected $firewall_name. Open NetworkChum LAN ports 4000/tcp (API) and 5173/tcp (Web UI)? [y/N]: "
  printf '%s' "$prompt" >/dev/tty
  if ! read -r answer </dev/tty; then
    answer=""
  fi

  case "$answer" in
    y | Y | yes | YES)
      printf '%s\n' "open"
      ;;
    "" | n | N | no | NO)
      printf '%s\n' "skip"
      ;;
    *)
      die "invalid firewall choice: $answer"
      ;;
  esac
}

open_firewall_ports() {
  firewall_name=$1

  case "$firewall_name" in
    firewalld)
      run_cmd sudo firewall-cmd --permanent --add-port=4000/tcp
      run_cmd sudo firewall-cmd --permanent --add-port=5173/tcp
      run_cmd sudo firewall-cmd --reload
      ;;
    ufw)
      run_cmd sudo ufw allow 4000/tcp
      run_cmd sudo ufw allow 5173/tcp
      ;;
    *)
      die "unsupported firewall: $firewall_name"
      ;;
  esac
}

maybe_add_kvm_access() {
  if [ ! -e /dev/kvm ]; then
    return
  fi

  if ! have_cmd getent; then
    return
  fi

  if ! getent group kvm >/dev/null 2>&1; then
    return
  fi

  user_name=$(current_user)
  if id -nG "$user_name" | grep -Eq '(^|[[:space:]])kvm($|[[:space:]])'; then
    return
  fi

  run_cmd sudo usermod -aG kvm "$user_name"
}

detect_linux_node_arch() {
  case "$(uname -m)" in
    x86_64 | amd64) printf '%s\n' "x64" ;;
    aarch64 | arm64) printf '%s\n' "arm64" ;;
    *) die "unsupported Linux architecture for direct Node.js install: $(uname -m)" ;;
  esac
}

install_linux_nodejs() {
  node_arch=$(detect_linux_node_arch)
  node_base_url="https://nodejs.org/download/release/latest-v${NODE_MAJOR}.x"
  temp_dir="/tmp/networkchum-nodejs"

  if [ "$DRY_RUN" -eq 0 ]; then
    temp_dir=$(mktemp -d)
  fi

  shasums_file="$temp_dir/SHASUMS256.txt"

  run_cmd mkdir -p "$temp_dir"
  run_cmd curl -fsSL "$node_base_url/SHASUMS256.txt" -o "$shasums_file"

  if [ "$DRY_RUN" -eq 1 ]; then
    archive_name="node-v${NODE_MAJOR}.x-linux-${node_arch}.tar.xz"
  else
    archive_name=$(awk "/linux-${node_arch}\\.tar\\.xz$/ { print \$2; exit }" "$shasums_file")
    if [ -z "$archive_name" ]; then
      die "could not resolve a Linux Node.js archive for architecture: $node_arch"
    fi
  fi

  archive_path="$temp_dir/$archive_name"
  install_dir="/usr/local/lib/nodejs/${archive_name%.tar.xz}"

  run_cmd curl -fsSL "$node_base_url/$archive_name" -o "$archive_path"
  run_cmd sh -c "cd '$temp_dir' && grep -F ' $archive_name' SHASUMS256.txt | sha256sum -c -"
  run_cmd sudo mkdir -p /usr/local/lib/nodejs
  run_cmd sudo rm -rf "$install_dir"
  run_cmd sudo tar -xJf "$archive_path" -C /usr/local/lib/nodejs
  run_cmd sudo ln -sf "$install_dir/bin/node" /usr/local/bin/node
  run_cmd sudo ln -sf "$install_dir/bin/npm" /usr/local/bin/npm
  run_cmd sudo ln -sf "$install_dir/bin/npx" /usr/local/bin/npx
  run_cmd sudo ln -sf "$install_dir/bin/corepack" /usr/local/bin/corepack

  # The official Node.js 26 x64 build links libatomic.so.1, which minimal
  # cloud images do not ship; the callers install the distro runtime package.
  # Fail here with a clear error instead of at the first npm invocation.
  if [ "$DRY_RUN" -eq 0 ]; then
    run_cmd "$install_dir/bin/node" --version
    rm -rf "$temp_dir"
  fi
}

install_macos() {
  run_cmd brew install git node qemu socat
  run_cmd brew install --cask docker
}

install_linux_apt() {
  runtime=$1
  user_name=$(current_user)

  run_cmd sudo apt update
  run_cmd sudo apt install -y git curl ca-certificates xz-utils libatomic1
  install_linux_nodejs
  run_cmd sudo apt install -y qemu-system-x86 qemu-utils iproute2 socat xterm

  case "$runtime" in
    podman)
      run_cmd sudo apt install -y podman podman-docker
      ;;
    docker)
      run_cmd sudo apt install -y docker.io
      run_cmd sudo systemctl enable --now docker
      run_cmd sudo usermod -aG docker "$user_name"
      ;;
    *)
      die "unsupported Linux container runtime: $runtime"
      ;;
  esac

  maybe_add_kvm_access
}

resolve_dnf_qemu_package() {
  if [ "$DRY_RUN" -eq 1 ] || ! have_cmd dnf; then
    printf '%s\n' "qemu-kvm"
    return
  fi

  # `dnf info` only sees installed packages, so ask the repos what is available.
  for package_name in qemu-kvm qemu-system-x86 qemu-system-x86-core; do
    if dnf list --available "$package_name" >/dev/null 2>&1; then
      printf '%s\n' "$package_name"
      return
    fi
  done

  printf '%s\n' "qemu-kvm"
}

install_linux_dnf() {
  runtime=$1
  user_name=$(current_user)
  qemu_package=$(resolve_dnf_qemu_package)

  run_cmd sudo dnf install -y git curl ca-certificates xz libatomic
  install_linux_nodejs
  # RHEL 9 ships /usr/libexec/qemu-kvm and only links it into PATH via the
  # qemu-kvm-core/qemu-kvm-tools split; install the core package alongside.
  run_cmd sudo dnf install -y "$qemu_package" qemu-img iproute socat xterm
  if [ "$qemu_package" = "qemu-kvm" ]; then
    run_cmd sudo dnf install -y qemu-kvm-core
  fi

  case "$runtime" in
    podman)
      run_cmd sudo dnf install -y podman podman-docker
      ;;
    docker)
      # moby-engine/docker-cli are Fedora-only; RHEL-family repos ship docker-ce
      # (when the upstream repo is enabled) or podman-docker as a CLI shim.
      if dnf list --available docker-ce >/dev/null 2>&1; then
        run_cmd sudo dnf install -y docker-ce docker-ce-cli containerd.io
      elif dnf list --available moby-engine >/dev/null 2>&1; then
        run_cmd sudo dnf install -y moby-engine docker-cli
      else
        run_cmd sudo dnf install -y podman podman-docker
      fi
      # podman-docker is a CLI shim with no docker.service or docker group.
      if [ "$DRY_RUN" -eq 1 ] || dnf list --installed docker-ce moby-engine >/dev/null 2>&1; then
        run_cmd sudo systemctl enable --now docker
        run_cmd sudo usermod -aG docker "$user_name"
      fi
      ;;
    *)
      die "unsupported Linux container runtime: $runtime"
      ;;
  esac

  maybe_add_kvm_access
}

install_linux_pacman() {
  runtime=$1
  user_name=$(current_user)

  run_cmd sudo pacman -Syu --noconfirm
  run_cmd sudo pacman -S --needed --noconfirm git curl ca-certificates xz gcc-libs
  install_linux_nodejs
  run_cmd sudo pacman -S --needed --noconfirm qemu-base qemu-desktop iproute2 socat xterm

  case "$runtime" in
    podman)
      run_cmd sudo pacman -S --needed --noconfirm podman podman-docker
      ;;
    docker)
      run_cmd sudo pacman -S --needed --noconfirm docker
      run_cmd sudo systemctl enable --now docker || true
      run_cmd sudo usermod -aG docker "$user_name"
      ;;
    *)
      die "unsupported Linux container runtime: $runtime"
      ;;
  esac

  maybe_add_kvm_access
}

install_linux_zypper() {
  runtime=$1
  user_name=$(current_user)

  run_cmd sudo zypper --non-interactive refresh
  run_cmd sudo zypper --non-interactive install git curl ca-certificates xz libatomic1
  install_linux_nodejs
  run_cmd sudo zypper --non-interactive install qemu-x86 qemu-tools iproute2 socat xterm

  case "$runtime" in
    podman)
      run_cmd sudo zypper --non-interactive install podman podman-docker
      ;;
    docker)
      run_cmd sudo zypper --non-interactive install docker
      run_cmd sudo systemctl enable --now docker || true
      run_cmd sudo usermod -aG docker "$user_name"
      ;;
    *)
      die "unsupported Linux container runtime: $runtime"
      ;;
  esac

  maybe_add_kvm_access
}

run_npm_install() {
  cd "$ROOT_DIR"
  run_cmd npm install
}

print_summary() {
  os_name=$1
  pkg_manager=$2
  runtime=${3:-}
  firewall_name=${4:-}
  firewall_action=${5:-skip}

  say ""
  say "Install plan complete."
  say "OS: $os_name"
  say "Package manager: $pkg_manager"
  if [ -n "$runtime" ]; then
    say "Linux container runtime: $runtime"
  fi
  if [ -n "$firewall_name" ]; then
    say "Firewall: $firewall_name"
    if [ "$firewall_action" = "open" ]; then
      say "LAN firewall rules: open 4000/tcp, 5173/tcp"
    else
      say "LAN firewall rules: unchanged"
    fi
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    say "Dry run only. No commands were executed."
    if [ -n "$firewall_name" ] && [ "$firewall_action" != "open" ]; then
      say "Firewall detected. If you plan to use ./start.sh lan, rerun with --open-firewall or open 4000/tcp and 5173/tcp manually."
    fi
    return
  fi

  say ""
  say "Recommended verification:"
  say "  node --version"
  say "  npm --version"
  say "  qemu-system-x86_64 --version || qemu-kvm --version || /usr/libexec/qemu-kvm --version"
  if [ "$os_name" = "linux" ]; then
    if [ "$runtime" = "podman" ]; then
      say "  podman --version"
      say "  docker --version"
    else
      say "  docker --version"
    fi
    if [ -n "$firewall_name" ]; then
      if [ "$firewall_name" = "firewalld" ]; then
        say "  sudo firewall-cmd --list-ports"
      else
        say "  sudo ufw status"
      fi
    fi
    say "  ls -l /dev/kvm"
    say ""
    say "If docker or kvm group membership changed, log out and back in before using those features."
    if [ -n "$firewall_name" ] && [ "$firewall_action" != "open" ]; then
      say "If you plan to use ./start.sh lan, rerun with --open-firewall or open 4000/tcp and 5173/tcp manually."
    fi
  else
    say "  docker version"
    say ""
    say "On macOS, launch Docker Desktop once after installation before using container nodes."
  fi
}

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=1
      ;;
    --yes | -y)
      ASSUME_YES=1
      ;;
    --os=macos | --os=linux)
      OS_OVERRIDE=${arg#--os=}
      ;;
    --package-manager=brew | --package-manager=apt | --package-manager=dnf | --package-manager=pacman | --package-manager=zypper)
      PKG_MANAGER_OVERRIDE=${arg#--package-manager=}
      ;;
    --container-runtime=podman | --container-runtime=docker)
      CONTAINER_RUNTIME=${arg#--container-runtime=}
      ;;
    --firewall=auto | --firewall=firewalld | --firewall=ufw | --firewall=none)
      FIREWALL_OVERRIDE=${arg#--firewall=}
      ;;
    --open-firewall)
      FIREWALL_ACTION="open"
      ;;
    --skip-firewall)
      FIREWALL_ACTION="skip"
      ;;
    --help | -h)
      print_usage
      exit 0
      ;;
    *)
      die "unknown option: $arg"
      ;;
  esac
done

OS_NAME=$(detect_os)
PKG_MANAGER=$(detect_package_manager "$OS_NAME")
ensure_supported_combo "$OS_NAME" "$PKG_MANAGER"

if [ "$OS_NAME" = "macos" ]; then
  if [ -n "$CONTAINER_RUNTIME" ]; then
    die "--container-runtime is only supported on Linux"
  fi
  if [ "$FIREWALL_OVERRIDE" != "auto" ] || [ -n "$FIREWALL_ACTION" ]; then
    die "firewall options are only supported on Linux"
  fi
  install_macos
  run_npm_install
  print_summary "$OS_NAME" "$PKG_MANAGER"
  exit 0
fi

LINUX_CONTAINER_RUNTIME=$(choose_container_runtime "$PKG_MANAGER")
LINUX_FIREWALL=$(detect_firewall)
LINUX_FIREWALL_ACTION=$(choose_firewall_action "$LINUX_FIREWALL")

case "$PKG_MANAGER" in
  apt)
    install_linux_apt "$LINUX_CONTAINER_RUNTIME"
    ;;
  dnf)
    install_linux_dnf "$LINUX_CONTAINER_RUNTIME"
    ;;
  pacman)
    install_linux_pacman "$LINUX_CONTAINER_RUNTIME"
    ;;
  zypper)
    install_linux_zypper "$LINUX_CONTAINER_RUNTIME"
    ;;
  *)
    die "unsupported package manager for Linux: $PKG_MANAGER"
    ;;
esac

run_npm_install
if [ "$LINUX_FIREWALL_ACTION" = "open" ]; then
  open_firewall_ports "$LINUX_FIREWALL"
fi

print_summary "$OS_NAME" "$PKG_MANAGER" "$LINUX_CONTAINER_RUNTIME" "$LINUX_FIREWALL" "$LINUX_FIREWALL_ACTION"
