#!/bin/sh
set -eu

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)

DRY_RUN=0
SCRIPT_NAME="dev"
SUDO_API=0
SERVICE_USER=""
MODE=${NETWORKCHUM_BIND_MODE:-localhost}
DATA_DIR=${NETWORKCHUM_DATA_DIR:-}
MODE_SET=0
DATA_DIR_SET=0
if [ -n "${NETWORKCHUM_BIND_MODE:-}" ]; then
  MODE_SET=1
fi
if [ -n "${NETWORKCHUM_DATA_DIR:-}" ]; then
  DATA_DIR_SET=1
fi
CONFIG_FILE=${NETWORKCHUM_START_CONFIG:-"$ROOT_DIR/.networkchum/start.conf"}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

print_usage() {
  cat <<'EOF'
Usage: ./start.sh [--dry-run] [--sudo-api] [localhost|lan|interface] [dev|dev:api|dev:web|dev:bridge|serve|doctor|forget|clean|install-service|uninstall-service] [--data-dir PATH]

Starts NetworkChum in localhost mode by default.

Modes:
  localhost   Bind the UI and API to loopback only
  lan         Bind the UI and API for LAN access
  interface   Alias for lan

Scripts:
  dev              Start the full stack (default)
  dev:api          Start the API only
  dev:web          Start the web UI only
  dev:bridge       Start the native console bridge only
  serve            Run the production build (requires: npm run build)
  doctor           Print config and host diagnostics, then exit (read-only)
  forget           Clear the saved last-run defaults
  clean            Remove exited NetworkChum containers (add --sudo-api for root's store)
  install-service  Install + start a systemd unit (Linux, needs sudo)
  uninstall-service  Stop + remove the systemd unit

Options:
  --data-dir PATH       Data directory for labs and images (default: apps/api/data)
  --sudo-api            On Linux, run the API with sudo so TAP/bridge setup can work
  --service-user NAME   User for the systemd service (default: current/SUDO_USER)

start.sh remembers the mode and --data-dir from the previous run and reuses them
when you do not pass them again. Pass them explicitly to override, or clear the
saved defaults with: ./start.sh forget
EOF
}

read_config_value() {
  config_key=$1
  [ -f "$CONFIG_FILE" ] || return 0
  sed -n "s/^${config_key}=//p" "$CONFIG_FILE" | head -n 1
}

save_config() {
  mkdir -p "$(dirname "$CONFIG_FILE")"
  {
    printf '# NetworkChum start.sh last-run defaults. Auto-generated; delete with: ./start.sh forget\n'
    printf 'MODE=%s\n' "$MODE"
    printf 'DATA_DIR=%s\n' "$DATA_DIR"
  } >"$CONFIG_FILE"
}

resolve_npm() {
  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return
  fi

  if [ -x /usr/local/bin/npm ]; then
    printf '%s\n' /usr/local/bin/npm
    return
  fi

  die "npm not found"
}

resolve_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi

  npm_path=$1
  npm_dir=$(dirname "$npm_path")
  if [ -x "$npm_dir/node" ]; then
    printf '%s\n' "$npm_dir/node"
    return
  fi

  die "node not found"
}

resolve_root_path() {
  npm_path=$1
  node_path=$2
  root_path="/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  npm_dir=$(dirname "$npm_path")
  node_dir=$(dirname "$node_path")

  case ":$root_path:" in
    *":$node_dir:"*) ;;
    *) root_path="$node_dir:$root_path" ;;
  esac

  case ":$root_path:" in
    *":$npm_dir:"*) ;;
    *) root_path="$npm_dir:$root_path" ;;
  esac

  printf '%s\n' "$root_path"
}

build_env_prefix() {
  if [ -n "$DATA_DIR" ]; then
    printf 'NETWORKCHUM_BIND_MODE=%s NETWORKCHUM_DATA_DIR=%s' "$MODE" "$DATA_DIR"
  else
    printf 'NETWORKCHUM_BIND_MODE=%s' "$MODE"
  fi
}

build_sudo_api_command() {
  npm_path=$1
  root_path=$2
  sudo_flags=$3
  sudo_prefix="sudo"

  if [ -n "$sudo_flags" ]; then
    sudo_prefix="$sudo_prefix $sudo_flags"
  fi

  if [ -n "$DATA_DIR" ]; then
    printf '%s env PATH=%s NETWORKCHUM_BIND_MODE=%s NETWORKCHUM_DATA_DIR=%s %s run dev:api' \
      "$sudo_prefix" "$root_path" "$MODE" "$DATA_DIR" "$npm_path"
  else
    printf '%s env PATH=%s NETWORKCHUM_BIND_MODE=%s %s run dev:api' \
      "$sudo_prefix" "$root_path" "$MODE" "$npm_path"
  fi
}

ensure_sudo_session() {
  if [ "$SUDO_API" -ne 1 ]; then
    return
  fi

  if [ "$SCRIPT_NAME" = "dev" ] || [ "$SCRIPT_NAME" = "dev:api" ]; then
    sudo -v
  fi
}

ensure_dependencies_installed() {
  case "$SCRIPT_NAME" in
    dev | dev:api)
      if ! "$NPM_PATH" ls --workspace @networkchum/api fast-xml-parser jszip >/dev/null 2>&1; then
        die "dependencies are missing or stale; run: npm install"
      fi
      ;;
  esac
}

resolve_lan_ip() {
  if command -v ip >/dev/null 2>&1; then
    ip route get 1.1.1.1 2>/dev/null | awk '
      {
        for (i = 1; i <= NF; i++) {
          if ($i == "src") {
            print $(i + 1)
            exit
          }
        }
      }
    '
    return
  fi

  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{ print $1 }'
  fi
}

resolve_target_port() {
  case "$SCRIPT_NAME" in
    dev | dev:web)
      printf '%s\n' "5173"
      ;;
    dev:api)
      printf '%s\n' "4000"
      ;;
    dev:bridge)
      printf '%s\n' "4010"
      ;;
    *)
      printf '%s\n' "5173"
      ;;
  esac
}

resolve_target_label() {
  case "$SCRIPT_NAME" in
    dev | dev:web)
      printf '%s\n' "URL"
      ;;
    dev:api)
      printf '%s\n' "API URL"
      ;;
    dev:bridge)
      printf '%s\n' "Bridge URL"
      ;;
    *)
      printf '%s\n' "URL"
      ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    localhost)
      MODE="localhost"
      MODE_SET=1
      ;;
    lan | interface)
      MODE="lan"
      MODE_SET=1
      ;;
    --data-dir)
      shift
      [ "$#" -gt 0 ] || die "--data-dir requires a path"
      DATA_DIR=$1
      DATA_DIR_SET=1
      ;;
    --data-dir=*)
      DATA_DIR=${1#--data-dir=}
      DATA_DIR_SET=1
      ;;
    --sudo-api)
      SUDO_API=1
      ;;
    --service-user)
      shift
      [ "$#" -gt 0 ] || die "--service-user requires a name"
      SERVICE_USER=$1
      ;;
    dev | dev:api | dev:web | dev:bridge | serve | doctor | forget | clean | install-service | uninstall-service)
      SCRIPT_NAME=$1
      ;;
    --help | -h)
      print_usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
  shift
done

if [ "$SCRIPT_NAME" = "forget" ]; then
  if [ -f "$CONFIG_FILE" ]; then
    rm -f "$CONFIG_FILE"
    printf 'Cleared saved last-run defaults (%s)\n' "$CONFIG_FILE"
  else
    printf 'No saved last-run defaults to clear\n'
  fi
  exit 0
fi

if [ "$SCRIPT_NAME" = "clean" ]; then
  if command -v podman >/dev/null 2>&1; then
    CLEAN_ENGINE=podman
  elif command -v docker >/dev/null 2>&1; then
    CLEAN_ENGINE=docker
  else
    die "neither podman nor docker found on PATH"
  fi

  run_engine() {
    if [ "$SUDO_API" -eq 1 ]; then
      sudo "$CLEAN_ENGINE" "$@"
    else
      "$CLEAN_ENGINE" "$@"
    fi
  }

  if ! CLEAN_IDS=$(run_engine ps -a --filter name=networkchum- \
    --filter status=exited -q); then
    die "failed to list containers with $CLEAN_ENGINE; if the API runs as root, retry with: ./start.sh --sudo-api clean"
  fi

  if [ -z "$CLEAN_IDS" ]; then
    printf 'No exited NetworkChum containers to remove (%s, user=%s)\n' \
      "$CLEAN_ENGINE" "$(id -un)"
    exit 0
  fi

  printf 'Exited NetworkChum containers (%s, user=%s):\n' \
    "$CLEAN_ENGINE" "$(id -un)"
  printf '%s\n' "$CLEAN_IDS"

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] would run: %s rm -f <ids above>\n' "$CLEAN_ENGINE"
    exit 0
  fi

  for clean_id in $CLEAN_IDS; do
    run_engine rm -f "$clean_id"
  done
  printf 'Removed %s container(s)\n' "$(printf '%s\n' "$CLEAN_IDS" | wc -l | tr -d ' ')"
  exit 0
fi

RESTORED=0
if [ "$MODE_SET" -eq 0 ]; then
  saved_mode=$(read_config_value MODE)
  if [ -n "$saved_mode" ]; then
    MODE=$saved_mode
    RESTORED=1
  fi
fi
if [ "$DATA_DIR_SET" -eq 0 ]; then
  saved_data_dir=$(read_config_value DATA_DIR)
  if [ -n "$saved_data_dir" ]; then
    DATA_DIR=$saved_data_dir
    RESTORED=1
  fi
fi

if [ "$RESTORED" -eq 1 ]; then
  printf 'Using saved last-run defaults from %s (mode=%s, data-dir=%s)\n' \
    "$CONFIG_FILE" "$MODE" "${DATA_DIR:-<default>}"
  printf 'Override with explicit args, or clear them with: ./start.sh forget\n'
fi

TARGET_PORT=$(resolve_target_port)
TARGET_LABEL=$(resolve_target_label)
NPM_PATH=$(resolve_npm)
NODE_PATH=$(resolve_node "$NPM_PATH")
ROOT_PATH=$(resolve_root_path "$NPM_PATH" "$NODE_PATH")
ENV_PREFIX=$(build_env_prefix)

if [ "$SCRIPT_NAME" = "doctor" ]; then
  cd "$ROOT_DIR"
  if [ -n "$DATA_DIR" ]; then
    export NETWORKCHUM_DATA_DIR="$DATA_DIR"
  fi
  export NETWORKCHUM_BIND_MODE="$MODE"
  exec "$NODE_PATH" "$ROOT_DIR/scripts/doctor.mjs"
fi

if [ "$SCRIPT_NAME" = "serve" ]; then
  API_CMD="$ENV_PREFIX $NODE_PATH $ROOT_DIR/apps/api/dist/server.js"
  WEB_CMD="$ENV_PREFIX $NODE_PATH $ROOT_DIR/scripts/serve-web.mjs"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %s %s exec concurrently -- -k -n api,web "%s" "%s"\n' \
      "$ENV_PREFIX" "$NPM_PATH" "$API_CMD" "$WEB_CMD"
    exit 0
  fi
  [ -f "$ROOT_DIR/apps/api/dist/server.js" ] ||
    die "no production API build at apps/api/dist; run: npm run build"
  [ -f "$ROOT_DIR/apps/web/dist/index.html" ] ||
    die "no production web build at apps/web/dist; run: npm run build"
  cd "$ROOT_DIR"
  exec sh -c "$NPM_PATH exec concurrently -- -k -n api,web \"$API_CMD\" \"$WEB_CMD\""
fi

if [ "$SCRIPT_NAME" = "install-service" ] ||
  [ "$SCRIPT_NAME" = "uninstall-service" ]; then
  UNIT_NAME=networkchum.service
  SYSTEM_UNIT_PATH=/etc/systemd/system/$UNIT_NAME
  USER_UNIT_PATH=${HOME:-/home/$(id -un)}/.config/systemd/user/$UNIT_NAME
  USER_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}

  user_systemctl() {
    XDG_RUNTIME_DIR="$USER_RUNTIME_DIR" systemctl --user "$@"
  }

  if [ "$SCRIPT_NAME" = "uninstall-service" ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      printf '[dry-run] sudo systemctl disable --now %s\n' "$UNIT_NAME"
      printf '[dry-run] sudo rm -f %s\n' "$SYSTEM_UNIT_PATH"
      printf '[dry-run] sudo systemctl daemon-reload\n'
      printf '[dry-run] systemctl --user disable --now %s\n' "$UNIT_NAME"
      printf '[dry-run] rm -f %s\n' "$USER_UNIT_PATH"
      printf '[dry-run] systemctl --user daemon-reload\n'
      exit 0
    fi
    command -v systemctl >/dev/null 2>&1 ||
      die "systemd (systemctl) not found; uninstall-service supports Linux systemd hosts only"
    if [ -f "$SYSTEM_UNIT_PATH" ]; then
      sudo systemctl disable --now "$UNIT_NAME" || true
      sudo rm -f "$SYSTEM_UNIT_PATH"
      sudo systemctl daemon-reload
    fi
    if [ -f "$USER_UNIT_PATH" ]; then
      user_systemctl disable --now "$UNIT_NAME" || true
      rm -f "$USER_UNIT_PATH"
      user_systemctl daemon-reload || true
    fi
    printf 'Removed %s\n' "$UNIT_NAME"
    exit 0
  fi

  UNIT_USER=${SERVICE_USER:-${SUDO_USER:-$(id -un)}}
  TAP_MODE=ambient
  SERVICE_SCOPE=system

  # SELinux denies a system unit (init_t) from executing a checkout under a home
  # directory (user_home_t). A per-user service runs in the user's unconfined
  # domain, so select that automatically on such hosts.
  if command -v getenforce >/dev/null 2>&1 &&
    [ "$(getenforce 2>/dev/null)" = "Enforcing" ]; then
    case "$ROOT_DIR" in
      "${HOME:-/nonexistent}"/*) SERVICE_SCOPE=user ;;
    esac
  fi
  # User scope can only manage the invoking user's own service.
  if [ "$SERVICE_SCOPE" = "user" ] && [ "$UNIT_USER" != "$(id -un)" ]; then
    SERVICE_SCOPE=system
  fi

  if [ "$SERVICE_SCOPE" = "user" ]; then
    UNIT_PATH=$USER_UNIT_PATH
  else
    UNIT_PATH=$SYSTEM_UNIT_PATH
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '# (dry-run) scope=%s; a real install probes capabilities and may use setcap on ip\n' \
      "$SERVICE_SCOPE"
  else
    command -v systemctl >/dev/null 2>&1 ||
      die "systemd (systemctl) not found; install-service supports Linux systemd hosts only"

    # Remove a stale system unit when switching this install to a user service.
    if [ "$SERVICE_SCOPE" = "user" ] && [ -f "$SYSTEM_UNIT_PATH" ]; then
      printf 'Removing stale system unit %s\n' "$SYSTEM_UNIT_PATH"
      sudo systemctl disable --now "$UNIT_NAME" || true
      sudo rm -f "$SYSTEM_UNIT_PATH"
      sudo systemctl daemon-reload
    fi

    # Re-running install should update an existing service cleanly.
    if [ "$SERVICE_SCOPE" = "user" ]; then
      if user_systemctl is-active --quiet "$UNIT_NAME"; then
        user_systemctl stop "$UNIT_NAME"
      fi
    elif systemctl is-active --quiet "$UNIT_NAME"; then
      sudo systemctl stop "$UNIT_NAME"
    fi

    if [ ! -x "$ROOT_DIR/node_modules/.bin/concurrently" ]; then
      printf 'Installing dependencies (one-time)...\n'
      "$NPM_PATH" install
    fi

    if [ ! -f "$ROOT_DIR/apps/api/dist/server.js" ] ||
      [ ! -f "$ROOT_DIR/apps/web/dist/index.html" ]; then
      printf 'Building production assets (one-time)...\n'
      "$NPM_PATH" run build
    fi

    port_in_use() {
      if command -v ss >/dev/null 2>&1; then
        ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1$"
      elif command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
      else
        return 1
      fi
    }
    for port in 4000 5173; do
      if port_in_use "$port"; then
        die "port $port is already in use. Stop the running stack first (e.g. Ctrl-C the dev stack, then: sudo pkill -f 'tsx watch src/server.ts'; pkill -f 'vite --port 5173'), then re-run."
      fi
    done

    grant_ip_capability() {
      IP_BIN=$(readlink -f "$(command -v ip)") ||
        die "ip not found; cannot grant the TAP capability"
      command -v setcap >/dev/null 2>&1 ||
        die "setcap not found (install libcap); cannot grant the TAP capability"
      sudo setcap cap_net_admin,cap_net_raw+ep "$IP_BIN"
      TAP_MODE=ip-capability
      printf '  granted cap_net_admin,cap_net_raw to %s\n' "$IP_BIN"
    }

    if [ "$SERVICE_SCOPE" = "user" ]; then
      # A user manager cannot grant ambient capabilities; use the ip file cap.
      printf 'Configuring TAP capability for the user service...\n'
      grant_ip_capability
    else
      probe_ambient_capabilities() {
        sudo systemd-run --collect --quiet --wait --pipe \
          --unit=networkchum-cap-probe \
          --uid="$1" \
          --gid="$(id -gn "$1")" \
          --property=AmbientCapabilities="CAP_NET_ADMIN CAP_NET_RAW" \
          /bin/sh -c '
            ip tuntap add dev nc-cap-probe0 mode tap >/dev/null 2>&1 || exit 10
            ip link del dev nc-cap-probe0 >/dev/null 2>&1 || true
            if command -v podman >/dev/null 2>&1; then
              podman unshare true >/dev/null 2>&1 || exit 20
            fi
            exit 0
          '
      }

      printf 'Probing TAP capability model as %s...\n' "$UNIT_USER"
      if probe_ambient_capabilities "$UNIT_USER"; then
        TAP_MODE=ambient
        printf '  ambient CAP_NET_ADMIN works with rootless podman\n'
      else
        probe_status=$?
        printf '  ambient CAP_NET_ADMIN unusable (probe exit %s); using setcap on ip\n' \
          "$probe_status"
        grant_ip_capability
      fi
    fi
  fi

  UNIT_CONTENT=$(NETWORKCHUM_UNIT_USER="$UNIT_USER" \
    NETWORKCHUM_ROOT="$ROOT_DIR" \
    NETWORKCHUM_BIND_MODE="$MODE" \
    NETWORKCHUM_DATA_DIR="$DATA_DIR" \
    NETWORKCHUM_SERVICE_SCOPE="$SERVICE_SCOPE" \
    NETWORKCHUM_TAP_MODE="$TAP_MODE" \
    "$NODE_PATH" "$ROOT_DIR/scripts/systemd-unit.mjs")

  if [ "$DRY_RUN" -eq 1 ]; then
    printf '# would write %s\n%s\n' "$UNIT_PATH" "$UNIT_CONTENT"
    if [ "$SERVICE_SCOPE" = "user" ]; then
      printf '[dry-run] mkdir -p %s\n' "$(dirname "$UNIT_PATH")"
      printf '[dry-run] systemctl --user daemon-reload\n'
      printf '[dry-run] systemctl --user enable --now %s\n' "$UNIT_NAME"
      printf '[dry-run] sudo loginctl enable-linger %s\n' "$UNIT_USER"
    else
      printf '[dry-run] sudo systemctl daemon-reload\n'
      printf '[dry-run] sudo systemctl enable --now %s\n' "$UNIT_NAME"
    fi
    exit 0
  fi

  if [ "$SERVICE_SCOPE" = "user" ]; then
    mkdir -p "$(dirname "$UNIT_PATH")"
    printf '%s\n' "$UNIT_CONTENT" >"$UNIT_PATH"
    user_systemctl daemon-reload
    user_systemctl enable --now "$UNIT_NAME"
    sudo loginctl enable-linger "$UNIT_USER"

    sleep 2
    if user_systemctl is-active --quiet "$UNIT_NAME"; then
      printf 'networkchum.service is active (user scope, user=%s, mode=%s, data-dir=%s, tap=%s)\n' \
        "$UNIT_USER" "$MODE" "${DATA_DIR:-<default>}" "$TAP_MODE"
      printf 'It will start on boot (linger enabled). Logs: journalctl --user -u %s -f\n' \
        "$UNIT_NAME"
    else
      printf 'networkchum.service failed to stay active. Recent logs:\n' >&2
      user_systemctl status "$UNIT_NAME" --no-pager >&2 || true
      exit 1
    fi
  else
    printf '%s\n' "$UNIT_CONTENT" | sudo tee "$UNIT_PATH" >/dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable --now "$UNIT_NAME"

    sleep 2
    if systemctl is-active --quiet "$UNIT_NAME"; then
      printf 'networkchum.service is active (system scope, user=%s, mode=%s, data-dir=%s, tap=%s)\n' \
        "$UNIT_USER" "$MODE" "${DATA_DIR:-<default>}" "$TAP_MODE"
      printf 'It will start on boot. Logs: journalctl -u %s -f\n' "$UNIT_NAME"
    else
      printf 'networkchum.service failed to stay active. Recent logs:\n' >&2
      sudo journalctl -u "$UNIT_NAME" -n 40 --no-pager >&2 || true
      exit 1
    fi
  fi
  exit 0
fi

if [ "$MODE" = "lan" ]; then
  LAN_IP=$(resolve_lan_ip || true)
  if [ -n "${LAN_IP:-}" ]; then
    printf 'LAN %s: http://%s:%s\n' "$TARGET_LABEL" "$LAN_IP" "$TARGET_PORT"
  else
    printf 'LAN %s: http://<server-ip>:%s\n' "$TARGET_LABEL" "$TARGET_PORT"
  fi
else
  printf 'Local %s: http://127.0.0.1:%s\n' "$TARGET_LABEL" "$TARGET_PORT"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  if [ "$SUDO_API" -eq 1 ] && [ "$SCRIPT_NAME" = "dev" ]; then
    printf '[dry-run] npm exec concurrently -- -k -n api,web,bridge "%s" "%s %s run dev:web" "%s %s run dev:bridge"\n' \
      "$(build_sudo_api_command "$NPM_PATH" "$ROOT_PATH" "-n")" \
      "$ENV_PREFIX" "$NPM_PATH" \
      "$ENV_PREFIX" "$NPM_PATH"
  elif [ "$SUDO_API" -eq 1 ] && [ "$SCRIPT_NAME" = "dev:api" ]; then
    printf '[dry-run] %s\n' "$(build_sudo_api_command "$NPM_PATH" "$ROOT_PATH" "")"
  else
    printf '[dry-run] %s %s run %s\n' "$ENV_PREFIX" "$NPM_PATH" "$SCRIPT_NAME"
  fi
  exit 0
fi

cd "$ROOT_DIR"
ensure_dependencies_installed
ensure_sudo_session
save_config

if [ "$SUDO_API" -eq 1 ] && [ "$SCRIPT_NAME" = "dev" ]; then
  API_CMD=$(build_sudo_api_command "$NPM_PATH" "$ROOT_PATH" "-n")
  WEB_CMD="$ENV_PREFIX $NPM_PATH run dev:web"
  BRIDGE_CMD="$ENV_PREFIX $NPM_PATH run dev:bridge"
  sh -c "$ENV_PREFIX $NPM_PATH exec concurrently -- -k -n api,web,bridge \"$API_CMD\" \"$WEB_CMD\" \"$BRIDGE_CMD\""
elif [ "$SUDO_API" -eq 1 ] && [ "$SCRIPT_NAME" = "dev:api" ]; then
  sh -c "$(build_sudo_api_command "$NPM_PATH" "$ROOT_PATH" "")"
else
  sh -c "$ENV_PREFIX $NPM_PATH run $SCRIPT_NAME"
fi
