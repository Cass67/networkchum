# iTerm URL Scheme Design

## Goal

Replace the brittle helper-based native iTerm launch path with iTerm's own URL scheme for reliable double-click terminal opening.

## Decision

Use iTerm's native URL scheme directly from the web app instead of the custom `networkchum://` helper.

## Why

- The custom helper path proved unreliable across repeated launches.
- Apple event and helper-app lifecycle behavior on macOS is brittle.
- The user explicitly wants the iTerm path, not a generic helper abstraction.
- A direct iTerm URL keeps the implementation smaller and removes the helper maintenance burden.

## Behavior

- `Native Console Preference: Open in iTerm` will open an iTerm-native URL.
- `Web Console` remains unchanged.
- `Copy Native Command` remains unchanged.
- Busy-console safeguards remain unchanged.

## Constraints

- This mode is explicitly iTerm-specific.
- It should gracefully fall back to `Copy Native Command` if the URL scheme is unavailable or unsupported.

## Testing Boundary

- Web tests verify URL generation only.
- No need to keep helper-install docs or helper runtime tests once the helper path is removed from the app flow.
