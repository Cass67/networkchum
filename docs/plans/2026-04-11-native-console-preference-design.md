# Native Console Preference Design

## Goal

Make native console launch a first-class, user-selectable global preference, while preserving the web console and copy-command fallback.

## Decision

Use a global app preference persisted in `localStorage` with three modes:

- `Web Console`
- `Copy Native Command`
- `Open in iTerm`

The `Open in iTerm` mode relies on a small local macOS helper registered to a custom URL scheme.

## Architecture

The browser app stays responsible for:

- storing the user’s native-console preference
- mapping runtime node telnet data into a launch target
- invoking either the web console, clipboard copy, or helper URL

The local helper is responsible for:

- registering a custom scheme such as `networkchum://`
- receiving `terminal`, `host`, and `port`
- launching `iTerm.app`
- executing `/usr/local/bin/telnet 127.0.0.1 <port>`

## UX

Add a global setting in the app shell or right-side panel:

- `Native Console Preference`

Options:

- `Web Console`
- `Copy Native Command`
- `Open in iTerm`

Default:

- `Web Console`

Persist using `localStorage`, reusing the same preference pattern already used for theme.

## Double-Click Behavior

- `Web Console`: double-click opens the in-browser serial console
- `Copy Native Command`: double-click copies `/usr/local/bin/telnet 127.0.0.1 <port>`
- `Open in iTerm`: double-click opens a helper URL such as:

  `networkchum://open-console?terminal=iterm&host=127.0.0.1&port=5004`

## Existing Actions

- `Open Console` remains a dedicated web-console action
- `Copy Native Command` remains available regardless of preference
- Telnet port stays visible in the UI

## Serial Console Constraint

QEMU serial is single-client.

If a native telnet session is already attached:

- disable `Open Console`
- show `Serial console already in use by another client.`

This keeps the web console honest about the transport limitation.

## Fallbacks

If `Open in iTerm` is selected but helper launch is unavailable:

- do not break UI state
- keep node selection intact
- allow fallback to `Copy Native Command`

If platform support is missing, degrade to `Copy Native Command`.

## Testing Boundary

Web app tests should verify:

- preference rendering and persistence
- double-click routing based on preference
- helper URL generation
- copy-command behavior
- disabled web-console behavior when serial is busy

Vitest should not attempt to fully integration-test local macOS app launch.

## File Scope

Web app:

- `apps/web/src/App.tsx`
- `apps/web/src/App.test.tsx`
- `apps/web/src/components/TopologyCanvas.tsx`
- `apps/web/src/components/LabDetails.tsx`

Docs:

- `docs/plans/2026-04-11-native-console-preference-design.md`
- follow-up implementation plan document

Helper:

- separate small macOS utility/script outside the browser-only runtime boundary
