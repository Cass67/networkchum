# Terminal Registry Design

## Goal

Make native terminal selection first-class by supporting built-in terminal choices plus user-defined custom terminals.

## Decision

Keep `Native Console Preference` generic and add a terminal registry UI with built-ins and saved custom entries.

## UX

### Native Console Preference

- `Web Console`
- `Copy Native Command`
- `Open in Terminal`

### Terminal Selector

- built-in entries such as:
  - `iTerm`
  - `Terminal.app`
- saved custom entries such as:
  - `Ghostty`
- final action:
  - `Add Terminal...`

### Add Terminal Flow

Form fields:

- `Name`
- `Command Template`

Example template:

- `ghostty -e /usr/local/bin/telnet {host} {port}`

Supported placeholders:

- `{host}`
- `{port}`

After save:

- new terminal appears in the selector immediately
- it is persisted locally
- it becomes selectable like a built-in entry

## Bridge Behavior

- built-in entries use built-in launcher paths
- custom entries use the saved template
- bridge expands `{host}` and `{port}` before execution
- bridge still validates host and port independently

## Data Model

- store terminal registry locally in the web app for now
- store selected terminal id/key separately from the registry

## Safety

- built-in entries stay structured and safe
- custom templates are explicitly user-authored advanced behavior
- fallback remains available through `Copy Native Command`

## Testing Boundary

- web tests verify:
  - rename of native console preference label
  - add-terminal dialog/form behavior
  - persistence and immediate appearance in selector
- bridge tests verify:
  - custom template expansion
  - placeholder substitution
  - malformed template rejection where applicable
