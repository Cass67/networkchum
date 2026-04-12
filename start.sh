#!/bin/sh
set -eu

ROOT_DIR=$(cd "$(dirname "$0")" && pwd)

DRY_RUN=0
MODE="localhost"
SCRIPT_NAME="dev"
DATA_DIR=""

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

print_usage() {
  cat <<'EOF'
Usage: ./start.sh [--dry-run] [localhost|lan|interface] [dev|dev:api|dev:web|dev:bridge] [--data-dir PATH]

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
EOF
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
  if [ -n "$DATA_DIR" ]; then
    printf '[dry-run] NETWORKCHUM_BIND_MODE=%s NETWORKCHUM_DATA_DIR=%s npm run %s\n' "$MODE" "$DATA_DIR" "$SCRIPT_NAME"
  else
    printf '[dry-run] NETWORKCHUM_BIND_MODE=%s npm run %s\n' "$MODE" "$SCRIPT_NAME"
  fi
  exit 0
fi

cd "$ROOT_DIR"
if [ -n "$DATA_DIR" ]; then
  NETWORKCHUM_BIND_MODE="$MODE" NETWORKCHUM_DATA_DIR="$DATA_DIR" npm run "$SCRIPT_NAME"
else
  NETWORKCHUM_BIND_MODE="$MODE" npm run "$SCRIPT_NAME"
fi
