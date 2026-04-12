# Node Boot Actions Design

## Goal

Replace the current implicit CSR startup-config behavior with an explicit, one-shot boot action per node, so normal power cycles preserve node state while operators can still request either a one-time startup-config injection or a one-time running-config backup on the next power-up.

## Problem

The current CSR1000v path treats the presence of startup-config text as a reason to reset the overlay disk on every power-on. In `apps/api/src/runtime/powerNode.ts`, `csr1000v-vfat` startup-config handling can force a fresh overlay so the day-0 config disk is honored. That makes CSR nodes behave like first boot on later power cycles and causes internal filesystems to be reformatted instead of booting with the node's saved config.

The product behavior should instead be explicit:

- Startup-config text may exist in the UI without being injected.
- Injection only happens when the operator asks for it.
- Injection is one-shot and auto-clears after the next launch attempt.
- Normal later power cycles preserve the node's own saved state.
- Running-config backup is also a one-shot boot action, separate from injection.

## Requirements

- Keep the existing startup-config text model and active config-set flow.
- Add a single mutually-exclusive boot action selector per node.
- Support exactly these boot actions for now:
  - `none`
  - `backup-once`
  - `inject-once`
- Auto-clear the selected boot action after the next power-on launch flow starts.
- Do not block node boot if a backup attempt later fails.
- Do not inject config when the selected action is `none`.
- Do not inject config when the selected action is `inject-once` but the config text is blank.
- Stop resetting CSR overlays during normal power-on just because startup-config text exists.
- Make the running-config backup framework generic across supported node types, even if support is implemented incrementally per template.

## Non-Goals

- No combined `inject and backup` action in this iteration.
- No persistent continuous backup mode.
- No schema redesign for startup-config sets.
- No automatic overwrite of startup-config text from captured running-config backups.

## Recommended Approach

Add an explicit per-node boot action record to the lab document and make `powerOnNode()` consume that intent once per launch attempt.

Startup-config text remains where it is today, inside the active startup-config set. Boot action selection becomes separate orchestration state:

- `none`: boot normally
- `backup-once`: boot normally, then schedule a single post-boot running-config capture
- `inject-once`: attach template-specific startup-config media once, then clear the action

This keeps the operator-visible model simple, removes the accidental CSR data-loss behavior, and creates a reusable orchestration layer for future features such as explicit reprovisioning.

## UX

### Per-node startup-config UI

In the startup-config area for each node, replace the current implicit behavior with:

- existing startup-config text editor
- new dropdown: `Next Power-Up Action`

Dropdown options:

- `No Boot Action`
- `Backup Running Config Once`
- `Inject Startup Config Once`

Behavior:

- Editing startup-config text alone does nothing.
- The dropdown expresses exactly one queued action for the next power-on.
- After the next power-on launch flow begins, the dropdown is reset to `No Boot Action`.
- If `Inject Startup Config Once` is chosen but the startup-config text is blank, boot proceeds normally and the action still clears.
- If `Backup Running Config Once` is chosen, boot proceeds normally and a background backup attempt is scheduled once.

### Backup visibility

Captured running-config backups should appear in node-related UI as timestamped artifacts with at least:

- timestamp
- node id/name
- capture source, e.g. `boot backup`
- success/failure status
- view/copy affordance

The initial implementation can expose these through API-first storage even if the UI view is basic.

## Data Model

Extend the shared topology model with explicit per-node boot actions.

Suggested shape:

```ts
type NodeBootAction = "none" | "backup-once" | "inject-once";

type NodeBootActionState = {
  nodeId: string;
  action: NodeBootAction;
  updatedAt?: string;
};
```

Add to `LabDocument`:

```ts
nodeBootActions?: NodeBootActionState[];
```

Notes:

- Keep this separate from `startupConfigSets`.
- Default missing state to `none`.
- Store one action record per node rather than trying to infer boot intent from config text.

## Architecture

### Boot orchestration flow

1. User saves startup-config text for a node in the active config set.
2. User selects a one-shot boot action in the node UI.
3. `powerOnNode()` resolves:
   - node template/runtime
   - active startup-config text for the node
   - queued boot action for the node
4. If action is `inject-once` and config text is non-empty:
   - build the template-specific startup-config artifact
   - attach it to QEMU/container launch as needed
5. Launch the node runtime.
6. Clear the queued boot action regardless of later success or failure of the boot-time action.
7. If action is `backup-once`, schedule a post-boot backup worker.
8. Backup worker waits for readiness, logs in via the node console, captures running config, stores the artifact, and records status.

### Runtime responsibilities

- `powerNode.ts`
  - orchestrates boot actions
  - no longer infers injection from startup-config text alone
  - no longer deletes CSR overlay merely because startup-config text exists
- `configInjectors.ts`
  - stays responsible only for creating and attaching startup-config artifacts
  - does not own overlay-reset policy
- new backup runtime module
  - generic boot-backup coordinator
  - per-platform adapter interface for login/readiness/capture commands

## CSR1000v Fix

The current CSR flow uses a day-0 FAT sidecar disk containing `iosxe_config.txt`. The bug is not only the artifact format; it is also the surrounding policy that resets the overlay to make day-0 injection happen repeatedly.

Required behavior change:

- Remove the current coupling between CSR startup-config presence and forced overlay reset during normal power-on.
- Only attach the CSR config-drive when the queued action is `inject-once`.
- Allow ordinary power cycles to reuse the existing overlay and the node's own saved config/state.

This means the current comment and logic around `needsFreshOverlay` in `powerNode.ts` must change from:

- "startup-config exists, reset overlay so day-0 disk works"

to:

- "normal power-on preserves overlay; explicit reprovisioning is a future separate action"

## Generic Running-Config Backup Framework

Running-config backup on boot cannot happen at launch time; it must happen post-boot after the device is reachable.

Introduce a generic adapter contract, for example:

```ts
type RunningConfigBackupAdapter = {
  supportsNode(node: LabNode): boolean;
  waitForReady(context: BackupContext): Promise<void>;
  captureRunningConfig(context: BackupContext): Promise<string>;
};
```

Coordinator responsibilities:

- select an adapter based on template/runtime
- wait for console readiness
- establish console session
- perform login prompts/expect-like flow
- disable paging where needed
- execute capture command
- normalize captured text
- persist backup artifact and status

Initial adapter expectations:

- Cisco IOS-XE / CSR1000v
  - login flow through serial console
  - capture via `show running-config`
- Arista vEOS
  - login flow through serial console
  - capture via `show running-config`
- Other platforms
  - report unsupported without failing node boot

## API Changes

Add or extend API support for per-node boot actions:

- read boot action state as part of lab fetch responses
- set boot action for a node
- clear boot action after launch attempt

Potential route shape:

- `PATCH /labs/:labId/nodes/:nodeId/boot-action`

Payload:

```json
{ "action": "none" | "backup-once" | "inject-once" }
```

Backup artifact listing/retrieval can either:

- piggyback on existing lab/node detail payloads for initial implementation, or
- use dedicated node-backup endpoints if artifact count grows

## State Transition Rules

### Inject once

- Precondition: node boot action is `inject-once`
- If config text exists and is non-empty:
  - attach startup-config artifact for this boot
- If config text is blank:
  - skip artifact creation
- In both cases:
  - clear boot action after launch attempt

### Backup once

- Precondition: node boot action is `backup-once`
- Boot proceeds normally
- Schedule one post-boot backup attempt
- Clear boot action after launch/scheduling
- If backup later fails, persist failure status but do not restore the action

### No action

- Boot proceeds normally
- No startup-config artifact
- No post-boot backup job

## Error Handling

- Injection artifact creation failure:
  - log template and node context
  - continue existing failed/partial launch behavior
  - action remains auto-cleared
- Backup scheduling failure:
  - record runtime/backup error
  - do not block boot
  - action remains auto-cleared
- Unsupported platform for backup:
  - record a clear unsupported status
  - do not block boot
- Blank config with `inject-once`:
  - skip injection quietly or with light diagnostic logging
  - action still clears

## Testing

### Automated

- Shared topology schema tests for node boot action persistence/defaulting
- API route tests for setting node boot action
- `powerOnNode()` tests that verify:
  - CSR no longer deletes overlay just because config text exists
  - injection only occurs when boot action is `inject-once`
  - blank config does not create CSR config media
  - boot action auto-clears after launch attempt
  - backup action auto-clears after scheduling
- Backup coordinator tests that verify:
  - unsupported templates are reported cleanly
  - adapter success stores backup text
  - adapter failure stores failure status without blocking boot

### Manual

- Boot CSR with config text present and `No Boot Action`
  - verify normal boot from existing saved state
- Boot CSR with `Inject Startup Config Once`
  - verify startup-config injection occurs once
  - verify later normal power cycle preserves saved state
- Boot vEOS with `Backup Running Config Once`
  - verify capture succeeds and artifact is stored
- Boot unsupported node with `Backup Running Config Once`
  - verify boot succeeds and UI/runtime shows unsupported backup status

## Future Extension

Once this boot-action model exists, explicit reprovisioning can be added cleanly as a separate destructive action:

- `Reprovision From Startup Config`

That future action can intentionally reset overlay/state and then run startup-config injection without overloading ordinary power-on semantics.
