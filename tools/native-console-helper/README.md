# NetworkChum Console Helper

This helper registers `networkchum://open-console` on macOS and launches `iTerm.app` with the matching telnet command.

## Install

From the repo root:

```bash
chmod +x scripts/install-networkchum-native-console-helper.sh
./scripts/install-networkchum-native-console-helper.sh
```

## Verify The Helper Logic

The installed app is now an AppleScript applet that handles repeated `networkchum://` opens via `on open location`.

```bash
open 'networkchum://open-console?terminal=iterm&host=127.0.0.1&port=5004'
open 'networkchum://open-console?terminal=iterm&host=127.0.0.1&port=5004'
```

Expected behavior: both opens launch or reuse the helper and create fresh iTerm tabs.

## Verify LaunchServices Registration

```bash
open 'networkchum://open-console?terminal=iterm&host=127.0.0.1&port=5004'
```

Expected behavior:

- macOS routes the URL to `NetworkChum Console Helper`
- the helper launches `iTerm.app`
- iTerm runs `/usr/local/bin/telnet 127.0.0.1 5004`
- repeated opens continue to work while the helper app is already running

## Reinstall After Changes

```bash
./scripts/install-networkchum-native-console-helper.sh
```

## Remove

```bash
rm -rf "$HOME/Applications/NetworkChum Console Helper.app"
```

## Fallback

If helper launch is unavailable, NetworkChum still supports `Copy Native Command` in the runtime sidebar.
