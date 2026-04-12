#!/bin/sh
set -eu

ROOT_DIR=$(cd "$(dirname "$0")/../.." && pwd)
HELPER="$ROOT_DIR/tools/native-console-helper/NetworkChumConsoleHelper.app/Contents/MacOS/networkchum-console-helper"
URL="networkchum://open-console?terminal=iterm&host=127.0.0.1&port=5004"

OUTPUT=$(NETWORKCHUM_HELPER_DRY_RUN=1 "$HELPER" "$URL")

printf '%s\n' "$OUTPUT" | grep '^terminal=iterm$'
printf '%s\n' "$OUTPUT" | grep '^host=127.0.0.1$'
printf '%s\n' "$OUTPUT" | grep '^port=5004$'
printf '%s\n' "$OUTPUT" | grep '^command=/usr/local/bin/telnet 127.0.0.1 5004$'
