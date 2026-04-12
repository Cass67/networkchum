# Native Console Bridge

Local bridge for opening native telnet consoles from the browser app.

## Startup

In local development the bridge now starts automatically with:

```bash
npm run dev
```

It can still be run standalone:

```bash
./scripts/run-native-console-bridge.sh
```

## Start

```bash
chmod +x scripts/run-native-console-bridge.sh
./scripts/run-native-console-bridge.sh
```

Expected output:

```text
Native console bridge listening on http://127.0.0.1:4010
```

## Verify With Curl

```bash
curl -s http://127.0.0.1:4010/health

curl -s -X POST http://127.0.0.1:4010/open-console \
  -H 'content-type: application/json' \
  -d '{"terminal":"iterm","host":"127.0.0.1","port":5004}'
```

Expected response:

```json
{"ok":true}
{"ok":true,"command":"/usr/local/bin/telnet 127.0.0.1 5004"}
```

## Platform Behavior

### macOS

- supports `iTerm` and `Terminal.app` through `osascript`

### Linux

- selects the first available launcher from:
  - `x-terminal-emulator`
  - `gnome-terminal`
  - `konsole`
  - `xfce4-terminal`
  - `xterm`

If no supported terminal launcher is available, the bridge returns an error and the web app should fall back to `Copy Native Command`.

## Test

```bash
node --test tools/native-console-bridge/server.test.js
```

## Fallback

If the bridge is not running, NetworkChum should still allow `Copy Native Command` and the web console path.
