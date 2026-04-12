# Native Console Bridge Design

## Goal

Provide a reliable local bridge for opening native telnet consoles from the browser app, starting with `iTerm` support.

## Decision

Use a localhost HTTP bridge bound to `127.0.0.1` instead of browser URL schemes or helper app routing.

## Architecture

- The web app sends a `POST` to a local bridge endpoint when the user preference is `Open in iTerm`.
- The bridge validates the request and launches `iTerm.app` with `/usr/local/bin/telnet 127.0.0.1 <port>`.
- The bridge is terminal-specific internally, but the browser contract is generic enough to support additional terminals later.

## First Version Scope

- terminal support: `iTerm` only
- host support: `127.0.0.1` / `localhost` only
- command support: telnet serial console only

## Operations

- Install/run the bridge locally from the repo via `scripts/`
- Listen only on `127.0.0.1`
- Use a fixed localhost port for the first version

## Security

- no arbitrary shell command execution from the browser
- bridge accepts only structured input:
  - `terminal`
  - `host`
  - `port`
- bridge itself constructs the final telnet command
- reject unsupported terminal names, hosts, or invalid ports

## UX

- `Native Console Preference: Open in iTerm` triggers the bridge
- `Web Console` remains unchanged
- `Copy Native Command` remains available
- if the bridge is unavailable, the app should show a clear message and leave fallback actions available

## Testing Boundary

- Web tests verify the bridge `fetch()` call and fallback behavior
- Bridge tests verify validation and dry-run launch behavior
- Do not attempt to fully automate iTerm integration in the normal test suite
