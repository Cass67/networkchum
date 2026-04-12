#!/bin/sh
set -eu

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
SOURCE_SCRIPT="$ROOT_DIR/tools/native-console-helper/NetworkChumConsoleHelper.applescript"
TARGET_DIR="$HOME/Applications"
TARGET_APP="$TARGET_DIR/NetworkChum Console Helper.app"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [ ! -f "$SOURCE_SCRIPT" ]; then
  echo "helper script not found: $SOURCE_SCRIPT" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
rm -rf "$TARGET_APP"
/usr/bin/osacompile -o "$TARGET_APP" "$SOURCE_SCRIPT"

/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$TARGET_APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$TARGET_APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleTypeRole string Viewer" "$TARGET_APP/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :CFBundleURLTypes:0:CFBundleTypeRole Viewer" "$TARGET_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string NetworkChum Console Helper" "$TARGET_APP/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :CFBundleURLTypes:0:CFBundleURLName NetworkChum Console Helper" "$TARGET_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$TARGET_APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string networkchum" "$TARGET_APP/Contents/Info.plist" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :CFBundleURLTypes:0:CFBundleURLSchemes:0 networkchum" "$TARGET_APP/Contents/Info.plist"

if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -f "$TARGET_APP" >/dev/null
fi

echo "Installed NetworkChum Console Helper to: $TARGET_APP"
echo "Verify with: open 'networkchum://open-console?terminal=iterm&host=127.0.0.1&port=5004'"
