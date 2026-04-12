# Cross-OS Native Console Bridge Design

## Goal

Start the native console bridge alongside the app and support double-click native terminal launch on both macOS and Linux through one browser contract.

## Decision

Use a localhost bridge started with app/dev startup. Keep the browser API stable and move OS-specific terminal launching into the bridge.

## Architecture

- Browser always calls the bridge on `127.0.0.1:<bridge-port>`.
- Bridge exposes `POST /open-console`.
- Payload stays structured and safe:
  - `host`
  - `port`
  - optional launcher hint later
- Bridge decides how to open the terminal for the current OS.

## Startup Model

- `npm run dev` should start:
  - API
  - web
  - native console bridge
- This gives a cross-OS startup path without requiring OS-specific background services first.

## OS Strategy

### macOS

- Start with a supported default terminal launcher path inside the bridge.
- Keep room for user-selectable terminal preferences later.

### Linux

- Detect and use an available terminal launcher in priority order.
- Possible candidates include:
  - `x-terminal-emulator`
  - `gnome-terminal`
  - `konsole`
  - `xfce4-terminal`
  - `xterm`

## UX

- Double-click means `Open native console`
- If bridge launch fails:
  - show a clear message
  - keep `Copy Native Command` available
- `Open Console` remains the web-console action

## Security

- Bridge binds only to `127.0.0.1`
- Bridge accepts only structured host/port input
- Bridge constructs the telnet command itself
- Reject unsupported hosts or invalid ports

## Testing Boundary

- Web tests verify bridge calls and fallback handling
- Bridge tests verify validation and OS-specific launcher selection logic
- Do not require real terminal apps in automated tests
