# Native Console UI Improvements Design

## Goal

Improve the native console experience with bridge health visibility, macOS terminal selection, and clear inline error handling.

## Decision

Build on the existing localhost bridge architecture and add first-class UI for bridge status, terminal choice, and launch failures.

## Architecture

- Keep `Native Console Preference` separate from terminal choice.
- Add a bridge health probe in the web app via `GET /health`.
- Add OS-specific terminal choice, starting with macOS:
  - `iTerm`
  - `Terminal.app`
- Store these as global app preferences.

## UX

Top-level settings area:

- `Native Console Preference`
- `macOS Terminal` when on macOS
- `Bridge: Online` / `Bridge: Offline`

Runtime/sidebar panel for telnet-backed nodes:

- `Telnet Port: <port>`
- `Double-click Action: Open in iTerm` or `Open in Terminal.app`
- inline error when bridge launch fails
- inline bridge-down message when the bridge is unavailable

## Behavior

- Double-click with native-console mode:
  - if bridge is online, POST to bridge with terminal + host + port
  - if bridge is offline, show an inline error and leave fallback actions available
- `Open Console` remains the web-console action
- `Copy Native Command` remains always available

## Bridge Contract

- `GET /health` -> bridge availability and metadata
- `POST /open-console` -> includes terminal choice

## Testing Boundary

- Web tests verify health, persistence, and inline error rendering
- Bridge tests verify health endpoint and terminal selection validation
