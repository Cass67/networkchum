# Cloud Bridge Groups Design

## Summary

This design upgrades NetworkChum's cloud-node model from a single generic "bridge to host" concept into a role-aware bridge-group system.

The approved operator model is:

- one `Cloud` node template remains in the catalog
- each cloud node gets a `Cloud Role` dropdown
- each cloud node also belongs to a reusable `Bridge Group`
- the first cloud in a given role/group creates the host-side bridge owned by NetworkChum
- later clouds in the same role/group reuse that same bridge

This solves two different needs cleanly:

- management access, where cloud nodes should share a management bridge
- private transport domains, where cloud nodes should create reusable internal-only bridges for things like MPLS or ISP carrier circuits

## Current State

The repo already supports cloud nodes, but the model is too narrow for the intended workflows:

- every cloud node is treated as the same kind of object
- the UI only exposes a single `Host Bridge` selection
- the backend currently expects that bridge to already exist
- there is no first-class distinction between management connectivity and private transport plumbing
- there is no app-owned bridge registry or reuse model

That forces operators to pre-create Linux bridges outside the app and does not support reusable private cloud domains cleanly.

## Goals

- Keep a single `Cloud` node template in the catalog.
- Add a `Cloud Role` model that distinguishes management from private transport use.
- Add reusable bridge-group semantics so multiple clouds can share a managed bridge domain.
- Let the first cloud in a role/group create the bridge automatically.
- Reuse that bridge for later clouds in the same role/group.
- Support multiple management clouds for canvas layout without creating duplicate management bridges.
- Support multiple separate private or carrier domains at the same time.
- Keep bridge ownership explicit and safe.

## Non-Goals

- Do not automatically enslave the host's active uplink into a bridge in this pass.
- Do not move the host IP address or default route automatically.
- Do not manage arbitrary existing host bridges created outside NetworkChum.
- Do not turn cloud nodes into a generic host-network reconfiguration console.
- Do not collapse all clouds into one shared bridge domain.

## Product Decisions Confirmed

- The catalog keeps one `Cloud` template, not multiple cloud templates.
- Cloud nodes get a `Cloud Role` dropdown rather than separate templates.
- Multiple management clouds may exist for layout purposes.
- The first management cloud creates the management bridge; later management clouds reuse it.
- The same reuse rule applies to private and carrier clouds, keyed by bridge group.
- Private and carrier cloud bridges are internal host bridges with no physical NIC attached.

## Cloud Roles

Introduce a new per-node field:

- `cloudRole`

Initial values:

- `management`
- `private-circuit`
- `isp-carrier`

Meaning:

- `management`
  - represents host-connected management access
  - multiple management clouds can exist in the canvas
  - all management clouds in the same group reuse one managed bridge
- `private-circuit`
  - represents internal transport domains such as MPLS handoff or service-provider core links
  - bridge is internal-only and TAP-backed
- `isp-carrier`
  - represents reusable simulated provider domains
  - bridge is internal-only and TAP-backed

The role controls bridge behavior. It does not by itself determine which bridge instance is used.

## Bridge Groups

Introduce a second per-node field:

- `bridgeGroup`

This is the sharing key for bridge reuse.

Examples:

- management:
  - `management`
  - `mgmt-west`
- private circuit:
  - `mpls-core`
  - `private-backhaul`
- ISP carrier:
  - `carrier-a`
  - `carrier-b`

Rules:

- nodes with the same `cloudRole` and `bridgeGroup` reuse one host-side managed bridge
- nodes with different groups get different bridges even if the role is the same
- `management` defaults to the reserved group `management`
- `private-circuit` and `isp-carrier` require an explicit non-empty group

This is the key distinction:

- `cloudRole` decides what kind of bridge behavior is allowed
- `bridgeGroup` decides whether two cloud nodes share the same bridge

## Bridge Lifecycle Model

NetworkChum should manage only app-owned bridges.

It should create deterministic bridge names from role plus group, store that mapping, and reuse it across power cycles and later node creation.

Recommended examples:

- `nc-mgmt`
- `nc-mgmt-west`
- `nc-priv-mpls-core`
- `nc-isp-carrier-a`

Recommended normalization:

- lowercase
- alphanumeric plus `-`
- truncated safely to Linux interface-length limits

### Management Role

For `management` clouds:

- the first cloud in group `management` creates the managed bridge if missing
- later management clouds in that same group reuse it
- this bridge is intended as the app-owned management anchor

Important safety boundary:

- NetworkChum creates the bridge, but does not automatically attach the host uplink, move addresses, or change the default route in this pass

### Private And Carrier Roles

For `private-circuit` and `isp-carrier` clouds:

- the first cloud for a given role/group creates an internal-only managed bridge
- later clouds in that same role/group reuse it
- no physical NIC is ever attached by the app
- only TAP interfaces created for node connections are attached to that bridge

This preserves the current operator intent without risking host-network breakage.

## Bridge Registry

Add a small managed-bridge registry in app data.

Each record should include:

- `role`
- `group`
- `bridgeName`
- `kind`
  - `management`
  - `internal`
- `createdBy`
  - for example `networkchum`

Optional metadata:

- `createdAt`
- `lastUsedAt`

This registry is the source of truth for app-owned bridges. It lets the app:

- reuse existing managed bridges deterministically
- avoid colliding with unrelated host bridges
- avoid deleting or mutating bridges it does not own

## UI Changes

### Add Node Dialog

When the selected template runtime is `cloud`, show:

- `Cloud Role` dropdown
- `Bridge Group` input

Behavior:

- if role is `management`
  - default group to `management`
  - show helper text that the first management cloud creates the bridge and later ones reuse it
- if role is `private-circuit` or `isp-carrier`
  - require the operator to provide a group such as `mpls-core` or `carrier-a`
  - show whether the bridge will be created or reused if that can be resolved cheaply

The current `Host Bridge` selector should be replaced by this role/group workflow for cloud nodes.

### Cloud Settings Dialog

The cloud settings dialog should expose the same two fields:

- `Cloud Role`
- `Bridge Group`

Changing either setting moves the cloud node into a different bridge domain.

### Operator Messaging

The UI should be explicit about reuse:

- "First cloud in this group creates the bridge"
- "Later clouds in this group reuse it"

For management:

- "Management clouds share the same managed bridge for the same group"

For private/carrier:

- "This bridge is internal to NetworkChum and is not attached to a physical NIC"

## Backend Behavior

### Topology Resolution

Cloud nodes should no longer be modeled as "pick an arbitrary existing host bridge."

Instead:

- resolve managed bridge from `cloudRole + bridgeGroup`
- create it if missing and the app owns that bridge class
- attach QEMU TAPs for connected networks directly to that managed bridge

### Validation

Validation should enforce:

- cloud nodes must have a valid `cloudRole`
- `bridgeGroup` must be present for every cloud node
- `management` may default to `management` if omitted by old data
- `private-circuit` and `isp-carrier` must not be empty

Validation should not reject app-owned managed bridges just because they did not exist before node creation. The app is now responsible for creating them.

### Cleanup

When a cloud node is deleted or reconfigured:

- detach only the TAPs that belong to that node/network path
- do not delete a managed bridge if other nodes still reference its role/group
- only consider deleting a managed bridge when the registry shows it is unused and app-owned

Bridge deletion can be deferred to a later cleanup pass if needed. Reuse correctness is more important than aggressive cleanup.

## Data Model Changes

Extend cloud node config with:

- `cloudRole`
- `bridgeGroup`

The existing `bridgeInterface` field should be retired for cloud nodes after migration, or derived only for backward compatibility during the transition.

Backward compatibility:

- old cloud nodes with `bridgeInterface` set should be mapped into a compatible form during load
- if the old value is `br-mgmt`, map to:
  - `cloudRole: management`
  - `bridgeGroup: management`
- if the old value represents another app-owned bridge and can be identified, map accordingly
- if the old value is not safely mappable, surface it for manual correction rather than silently guessing

## Safety Rules

These rules are mandatory:

- never automatically enslave the host's active uplink in this pass
- never move host IP addresses automatically in this pass
- never modify bridges not recorded as app-owned
- never delete non-NetworkChum bridges
- never assume all clouds should share one bridge

This preserves SSH stability to the host while still enabling reusable cloud transport domains.

## Implementation Outline

### Phase 1: Schema And Registry

- add `cloudRole` and `bridgeGroup` to shared node config types
- add managed-bridge registry persistence in the API data directory
- add naming and normalization helpers

### Phase 2: Backend Bridge Resolution

- replace cloud `bridgeInterface` resolution with managed bridge lookup
- create app-owned bridges on demand
- reuse bridges by role/group
- update live TAP reconciliation and power-on logic

### Phase 3: UI Flow

- replace `Host Bridge` select in cloud add/settings dialogs
- add `Cloud Role` dropdown
- add `Bridge Group` field and helper copy
- display create-or-reuse intent clearly

### Phase 4: Migration And Cleanup

- normalize compatible old cloud data
- preserve old labs where possible
- add safe warnings for ambiguous legacy values

## Testing Strategy

Add tests for:

- first management cloud creates the management bridge
- second management cloud with the same group reuses that bridge
- private clouds with the same group reuse one internal bridge
- private clouds with different groups create different bridges
- carrier clouds with different groups create different bridges
- deleting one cloud does not tear down a bridge still referenced by another cloud
- app does not mutate non-owned bridges
- old `br-mgmt` cloud configs normalize safely to the new role/group model

UI tests should verify:

- add-node dialog shows `Cloud Role` and `Bridge Group`
- management defaults to group `management`
- private/carrier roles require a group
- settings dialog edits role/group correctly

## Risks

- Migration from `bridgeInterface` to role/group needs a conservative fallback path.
- Interface-name length limits require deterministic truncation logic.
- Bridge cleanup can become risky if ownership is not tracked carefully.
- Operators may still expect management bridges to provide external LAN access automatically, which this pass will not configure by itself.

## Future Follow-Up

After this design lands, a separate explicit feature can be designed for optional host uplink attachment to the app-owned management bridge.

That future feature should be:

- host-specific
- opt-in
- explicit about network impact
- designed with rollback and SSH-safety in mind

It should not be bundled into this bridge-group feature.
