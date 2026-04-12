# Lab Store Safety And Backup Restore Design

## Goal

Make lab persistence safe against corruption and add lab-scoped backup listing/restoration from the lab context menu.

## Decision

Fix persistence first with atomic, serialized writes to `labs.json`, then add backup list/restore actions on lab right-click.

## Architecture

- Replace direct `writeFile(labs.json, ...)` with atomic temp-file + rename writes.
- Serialize lab-store writes through a simple in-process queue/mutex.
- Keep auto-backup snapshots under `apps/api/data/lab-backups/<lab-id>/`.
- Add API endpoints to list backups and restore a selected snapshot.
- Add lab browser context-menu actions:
  - `List Backups`
  - `Restore Backup`

## UX

- Right-click a lab in the lab list
- `List Backups` opens a dialog with timestamped snapshots
- Snapshot rows can show:
  - timestamp
  - `Restore`
- Restoring requires confirmation

## Safety

- Restore only replaces the selected lab record
- No silent overwrite
- Running QEMU is not touched automatically by restore

## Why This Order

- Backup/restore depends on a trustworthy store
- Fixing `labs.json` corruption risk first prevents more recovery incidents
