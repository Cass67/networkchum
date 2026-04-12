#!/bin/sh
set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
node "$ROOT_DIR/tools/native-console-bridge/server.js"
