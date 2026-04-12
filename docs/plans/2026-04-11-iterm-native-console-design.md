# iTerm Native Console Design

## Goal

Open a telnet-backed node in `iTerm.app` on double-click, while keeping the existing in-browser console intact.

## Decision

Use a macOS-specific native console launcher for iTerm instead of relying on the system `telnet://` URL handler.

## Why

- `telnet://` is unreliable on this machine because LaunchServices is not bound to a working telnet handler.
- `iTerm.app` is installed and explicitly requested.
- NetworkChum already has the host, port, and node context needed to launch a native terminal session.

## Behavior

- Double-click a running telnet-backed node: launch `iTerm.app` and run `/usr/local/bin/telnet 127.0.0.1 <port>`.
- Keep the existing `Open Console` button and web console unchanged.
- Show the telnet port in the sidebar/runtime UI.
- If native launch fails, preserve current UI state and expose a copyable fallback command.

## Scope

- Web-only change.
- No backend change required.
- macOS/iTerm path first; keep behavior conservative for other platforms.

## Implementation Shape

- Add a small native-console helper in the web app that calls a local launcher endpoint or browser-safe bridge if already available.
- If no safe browser-to-local bridge exists, fall back to copying the command and keep the double-click behavior gated behind supported environments.
- Thread node telnet connection data from existing runtime state into the canvas double-click path and sidebar display.

## Risks

- Browsers cannot directly spawn local apps without some OS/browser bridge.
- If no existing local bridge exists in NetworkChum, a pure frontend-only iTerm launch is not possible.
- In that case, the practical fallback is copy-to-clipboard plus explicit instructions, or adding a tiny local helper later.

## Success Criteria

- Double-click on a telnet-backed node takes the user to a native iTerm flow on supported setups.
- Web console remains available.
- Telnet port remains visible in the UI.
