# CSR1000v Startup Config Design

## Goal

Make `cisco-asr` nodes boot an injected startup config reliably when a node config exists in the active config set, while keeping the current behavior of not attaching any startup-config artifact when no config text is present.

## Current State

- Startup configs are stored in `LabDocument.startupConfigSets` and selected via `activeConfigSetId` in `packages/shared/src/topology.ts`.
- `apps/api/src/runtime/powerNode.ts` resolves the active node config at power-on time.
- vEOS works because `injectVeosFlash()` writes `/startup-config` directly into the node overlay disk.
- CSR1000v currently uses `injectCsr1000vVfat()`, which creates a FAT image containing `iosxe_config.txt` and attaches it as a sidecar QEMU drive.

## Problem

The config-set model is not the failing part. The likely failure is that the current CSR1000v day-0 artifact layout or QEMU drive attachment is not compatible with the specific CSR1000v image being booted, so the node falls through to ZTP instead of consuming the injected config.

## Requirements

- Only inject CSR1000v startup config when config text exists for that node in the active config set.
- Keep the existing startup-config data model unchanged.
- Make the CSR1000v boot artifact strategy explicit rather than hardcoding one assumed layout.
- Preserve command preview and add enough logging to show which CSR layout was attempted.
- Keep the change API-local unless shared schema changes become necessary later.

## Recommended Approach

Introduce a CSR1000v-specific boot artifact strategy layer inside `apps/api/src/runtime/configInjectors.ts` and make `powerNode.ts` use that abstraction instead of assuming a single FAT-on-virtio layout.

The first implementation should keep the existing `iosxe_config.txt` payload but separate:

- artifact creation
- QEMU drive attachment arguments
- layout naming/logging

This keeps the product model stable while making it easy to test and swap CSR layouts until one matches the actual image behavior.

## Architecture

### Runtime data flow

1. User saves config text into a node entry inside the active startup config set.
2. `powerOnNode()` resolves the active set and the node-specific config text.
3. If no config exists, no CSR artifact is created or attached.
4. If config exists and the template uses the CSR method, runtime code builds a named CSR boot artifact.
5. The injector returns the exact QEMU args needed for that artifact.
6. `buildQemuCommand()` appends those args and QEMU launches with a command preview that reflects the chosen layout.

### Components

- `apps/api/src/runtime/configInjectors.ts`
  - Refactor CSR logic into a named helper that returns both artifact metadata and drive args.
  - Keep current FAT image generation as the first supported layout.
- `apps/api/src/runtime/powerNode.ts`
  - Continue resolving startup config from the active config set.
  - Replace the direct `injectCsr1000vVfat()` call with the new CSR helper.
  - Log the selected CSR layout and attachment args.
- `apps/api/src/runtime/powerNode.test.ts`
  - Add tests that assert CSR nodes with config get the expected drive args.
  - Add tests that CSR nodes without config do not get a config artifact.

## Error Handling

- If artifact creation fails, retain the existing warning path and include the layout name in the log message.
- If no config exists, skip injection quietly.
- If QEMU launch fails, keep persisting the command preview so the attempted CSR layout can be inspected.

## Testing

Automated:

- Unit tests for the CSR injector helper output.
- Unit tests for `powerOnNode()` behavior with and without CSR startup config.

Manual:

- Boot a real CSR1000v image with a non-empty startup config.
- Verify the node does not fall into ZTP and can show the injected config on first boot.
- Boot the same node with no startup config entry and verify no config artifact is attached.

## Notes

- This design does not change `packages/shared` because the problem is in runtime boot mechanics, not in persisted config structure.
- If multiple CSR image variants later need different layouts, the runtime strategy layer can expand without forcing a UI or schema change.
