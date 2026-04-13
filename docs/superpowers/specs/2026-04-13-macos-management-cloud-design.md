# macOS Management Cloud Design

## Summary

This design defines the macOS target behavior for `management` cloud nodes.

Approved target:

- macOS must support management-cloud workflows as a first-class platform target
- the macOS behavior does not need to match Linux L2 bridging exactly
- operators need direct SSH reachability from the Mac host to managed nodes
- the management subnet should be a single global subnet across all labs
- nodes will use static management addressing, not DHCP

The resulting product model is:

- Linux `management` clouds continue to use TAP and Linux bridge integration
- macOS `management` clouds use a dedicated host-only management network
- that network uses one fixed global subnet
- the operator statically configures node management IPs inside that subnet
- the Mac host can reach those node IPs directly for SSH and similar management traffic
- if the macOS management backend is unavailable, the app fails clearly instead of falling back to Podman NAT

## Current State

Today the codebase has two cloud behaviors:

- Linux uses the TAP backend and managed Linux bridges
- non-Linux hosts fall through to the socket backend and launch an Alpine helper container as a NAT gateway

That fallback is not a valid management-cloud experience for macOS:

- it depends on Docker/Podman availability
- it does not provide a clear host-only management subnet
- it does not give the operator a stable static-IP management model
- it creates confusing behavior differences between Linux and macOS

This is why the current fallback produces the wrong operator experience for `management` clouds on macOS.

## Goals

- Make `management` cloud nodes usable on macOS without depending on Podman or Docker.
- Provide direct host-to-node reachability for SSH from the Mac.
- Use one fixed global management subnet across all labs.
- Make the subnet visible and understandable in the UI.
- Preserve the current Linux management-cloud behavior unchanged.
- Keep private/circuit and ISP/carrier cloud roles isolated from host-only management behavior on macOS.

## Non-Goals

- Do not provide full Linux-style L2 bridging from macOS into the physical LAN.
- Do not promise LAN-wide reachability from other devices on the network.
- Do not add DHCP in this pass.
- Do not overload private/ISP clouds with management semantics.
- Do not silently fall back to the current container NAT helper for management-cloud power-on.

## Product Decisions Confirmed

- macOS `management` cloud means host-only management reachability.
- Nodes use static IP addressing.
- The management subnet is global, not per-lab.
- The operator needs to know the management subnet so they can assign static IPs accordingly.

## Recommended Platform Model

## Linux

No behavior change:

- `management` cloud keeps using TAP networking
- managed Linux bridges remain the source of truth
- Linux can still bridge management traffic into the host/LAN path as currently designed

## macOS

`management` cloud becomes a separate host-only management implementation:

- use a macOS host-side networking mechanism suitable for a fixed host-only subnet
- reserve one global management subnet for the app
- expose a fixed host-side management address for the Mac on that subnet
- connect all macOS management-cloud traffic to that host-only management network

Recommended default subnet:

- subnet: `172.31.255.0/24`
- host-side management IP: `172.31.255.1`

Operator model:

- connect a node to a `management` cloud
- configure the node management interface statically within `172.31.255.0/24`
- avoid `172.31.255.1`
- SSH from the Mac directly to the node IP

Example:

- Mac host: `172.31.255.1`
- CSR management IP: `172.31.255.10`
- Arista management IP: `172.31.255.11`

## Behavioral Rules

## Cloud Roles On macOS

### `management`

- must use the dedicated host-only management backend
- must not use the Podman/Docker NAT helper path
- must fail with a clear message if host-only management networking is unavailable

### `private-circuit`

- remains an internal isolated cloud construct
- does not expose direct host IP reachability
- should continue using the existing non-Linux internal/socket behavior

### `isp-carrier`

- remains an internal isolated cloud construct
- does not expose direct host IP reachability
- should continue using the existing non-Linux internal/socket behavior

## Failure Model

If the macOS management backend cannot be started, the node power-on must fail with an explicit message such as:

`Management cloud on macOS requires the host-only management backend, but it is unavailable on this host.`

It must not:

- try to start `alpine:latest`
- auto-select Podman
- auto-select Docker
- present the old NAT helper as if it were management-cloud support

## UX Changes

## Cloud Creation / Settings

When a cloud node is set to role `management`, the dialog and inspector should show macOS-specific guidance when the current API host is macOS:

- `macOS management subnet: 172.31.255.0/24`
- `Host IP: 172.31.255.1`
- `Assign static IPs on connected node management interfaces`

This guidance should appear in:

- Add Cloud dialog
- Cloud Settings dialog
- selected cloud inspector panel

## Host Capability Visibility

The app should expose the active networking mode clearly enough that operators can distinguish:

- Linux TAP management
- macOS host-only management
- generic socket backend behavior

A lightweight backend badge or health payload field is sufficient.

## API / Backend Design

## Capability Detection

Extend host capability detection so the API can distinguish:

- `linux-tap`
- `macos-host-only-management`
- `socket-fallback`

This should be explicit, not inferred by the web app.

## Cloud Power-On Routing

In `powerNode.ts`:

- if node runtime is `cloud` and role is `management`
  - on Linux: use the existing TAP/bridge path
  - on macOS: use the new host-only management backend
  - on other hosts: fail clearly
- only non-management clouds may continue using the non-Linux socket/container fallback path if that behavior is still desired

This is the critical behavior split that prevents future Podman confusion.

## Global Management Network

Introduce a dedicated global management-network abstraction for macOS:

- singleton subnet configuration
- singleton host-side IP
- attach/detach bookkeeping for powered-on management clouds
- reference counting or equivalent so multiple management clouds across labs reuse the same underlying host-only network safely

The first macOS management cloud powers up the host-only management backend.

Additional macOS management clouds:

- reuse the same global backend
- do not create isolated per-lab management networks

When the last macOS management cloud is powered off:

- either keep the backend warm for the app lifetime
- or tear it down cleanly if teardown is reliable

Recommendation:

- keep it warm for the API process lifetime once initialized

That reduces flakiness and avoids repeated host-network churn.

## Data Model

No new user-facing topology field is required for the initial version if the subnet is fixed and global.

Current cloud settings remain:

- `cloudRole`
- `bridgeGroup`

For macOS:

- `management` clouds can continue to use `bridgeGroup: "management"`
- the global subnet stays an application/platform constant in the first pass

If configurability is needed later, it can be introduced as host-level app settings rather than per-node topology state.

## Testing Strategy

## Backend Tests

Add tests covering:

- macOS management cloud does not choose the Podman/Docker NAT helper path
- macOS management cloud selects the host-only management backend
- macOS management cloud fails clearly when that backend is unavailable
- non-management clouds on macOS keep their existing isolated behavior
- multiple management clouds reuse one global backend

## UI Tests

Add tests covering:

- management cloud dialogs show the fixed subnet and host IP on macOS
- Linux does not show the macOS-specific guidance
- failure messages are clear when management-cloud backend support is unavailable

## Documentation

Update:

- `INSTALL.md`
- `README.md`
- architecture docs where platform networking behavior is described

The docs must explicitly state:

- Linux management cloud is bridge-based
- macOS management cloud is host-only
- macOS management cloud uses static IPs on `172.31.255.0/24`
- the Mac host uses `172.31.255.1`
- macOS does not currently provide LAN-wide bridging through management clouds

## Risks

- macOS host-only networking is more platform-specific than the Linux bridge path.
- Privilege and platform API constraints may make one implementation strategy more reliable than another.
- Keeping the existing container fallback around for other cloud roles increases the need for clear branching logic.
- If backend capability reporting is vague, operators will continue to confuse macOS-local and Linux-bridged behavior.

## Recommendation

Implement macOS `management` cloud as a dedicated host-only networking backend with:

- global subnet `172.31.255.0/24`
- host IP `172.31.255.1`
- static node addressing
- explicit backend selection
- explicit failure if unavailable
- no Podman/Docker fallback for management clouds

This gives macOS a real, predictable management story without pretending it can do the same host/LAN bridge model as Linux.
