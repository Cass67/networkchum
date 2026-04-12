# Lab Auto Backup Design

## Goal

Add a per-lab automatic backup safety net that writes timestamped JSON snapshots after each successful lab mutation.

## Decision

Use a per-lab `Auto Backup` toggle in the lab inspector and write timestamped lab-document snapshots to a local backup folder under the API data directory.

## Architecture

- backup folder root:
  - `apps/api/data/lab-backups/`
- per-lab folder:
  - `apps/api/data/lab-backups/<lab-id>/`
- backup file format:
  - JSON snapshot of the lab document/record
- backup trigger:
  - after successful lab mutations

## UX

Lab inspector adds:

- `Auto Backup` checkbox

When enabled:

- successful mutations silently write a backup snapshot

## Retention

- keep newest 10 backups per lab
- remove older backups automatically after a new snapshot is written

## Failure Behavior

- backup write failure must not fail the actual lab mutation
- log backup failures server-side

## Testing Boundary

- API tests verify backup creation, disabled state, and retention trimming
- web tests verify checkbox rendering and toggling
