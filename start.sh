#!/bin/sh
set -eu

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)

DRY_RUN=0
MODE="localhost"
SCRIPT_NAME="dev"
DATA_DIR=""
SUDO_API=0

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

print_usage() {
  cat <<'EOF'
Usage: ./start.sh [--dry-run] [--sudo-api] [localhost|lan|interface] [dev|dev:api|dev:web|dev:bridge] [--data-dir PATH]

Starts NetworkChum in localhost mode by default.

Modes:
  localhost   Bind the UI and API to loopback only
  lan         Bind the UI and API for LAN access
  interface   Alias for lan

Scripts:
  dev         Start the full stack (default)
  dev:api     Start the API only
  dev:web     Start the web UI only
  dev:bridge  Start the native console bridge only

Options:
  --sudo-api  On Linux, run the API with sudo so TAP/bridge setup can work
EOF
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
      ;;
    lan | interface)
      MODE="lan"
      ;;
    --data-dir)
      shift
      [ "$#" -gt 0 ] || die "--data-dir requires a path"
      DATA_DIR=$1
      ;;
    --data-dir=*)
      DATA_DIR=${1#--data-dir=}
      ;;
    --sudo-api)
      SUDO_API=1
      ;;
    dev | dev:api | dev:web | dev:bridge)
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

TARGET_PORT=$(resolve_target_port)
TARGET_LABEL=$(resolve_target_label)
NPM_PATH=$(resolve_npm)
NODE_PATH=$(resolve_node "$NPM_PATH")
ROOT_PATH=$(resolve_root_path "$NPM_PATH" "$NODE_PATH")
ENV_PREFIX=$(build_env_prefix)

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
ensure_sudo_session

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
