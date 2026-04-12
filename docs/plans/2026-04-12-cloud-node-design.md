# Cloud Node Design

## Overview

A "cloud" device type that bridges internal network segments to the host's physical LAN. Drag it onto the canvas, cable it to a network segment, power it on — VMs on that segment become reachable from the real network.

## Template

```
id: "cloud"
runtime: "cloud"
displayName: "Cloud (External Network)"
vendor: "NetworkChum"
boot: { console: "none", acceleration: "n/a" }
configSchema: { ramMb: {default:0,min:0,max:0}, vcpu: {default:0,min:0,max:0}, interfaceCount: { default: 1, min: 1, max: 8 } }
```

No image, no console, no disk. Pure networking construct.

## Behavior

### Linux (TAP backend)

On power-on, for each attached interface:

1. Find the segment's Linux bridge (`nc-br-*`)
2. Add the host's physical NIC (e.g. `eth0`) to that bridge via `ip link set dev eth0 master nc-br-xxx`
3. VMs on that segment now share L2 with the LAN — they get DHCP from the real network

On power-off:

1. Remove the physical NIC from the bridge: `ip link set dev eth0 nomaster`
2. The bridge returns to isolated mode

### macOS (socket backend — NAT fallback)

On power-on:

1. Launch a lightweight Alpine container as a NAT gateway
2. The container has two NICs: one on the internal Docker network (`nc-net-*`), one on Docker's default bridge (which has internet access)
3. Enable IP forwarding and iptables masquerade inside the container
4. Internal VMs get outbound access via NAT but aren't directly reachable from LAN

On power-off:

1. Stop and remove the NAT container
2. iptables rules are cleaned up automatically (container teardown)

## Data Model Changes

- `RuntimeKindSchema`: add `"cloud"` to the enum
- `LabNodeSchema`: already has `runtime: RuntimeKindSchema` — cloud nodes use `runtime: "cloud"`
- `RuntimeState.runtime`: already a string — store `"cloud"`
- `TemplateSchema.boot.console`: needs `"none"` added to the enum (currently `"serial" | "vnc"`)

## Key Files to Modify

| File                                         | Change                                       |
| -------------------------------------------- | -------------------------------------------- |
| `packages/shared/src/topology.ts`            | Add `"cloud"` to `RuntimeKindSchema`         |
| `packages/shared/src/catalog.ts`             | Add `"none"` to console enum                 |
| `apps/api/src/templates/defaultTemplates.ts` | Add cloud template                           |
| `apps/api/src/catalog/getCatalog.ts`         | Include cloud templates in catalog           |
| `apps/api/src/topology/mutations.ts`         | Handle cloud node creation (no image needed) |
| `apps/api/src/routes/labs.ts`                | Skip image resolution for cloud nodes        |
| `apps/api/src/runtime/powerNode.ts`          | Add cloud power-on/off logic                 |
| `apps/api/src/network/reconcileTopology.ts`  | Bridge physical NIC on Linux                 |
| `apps/web/src/App.tsx`                       | Add cloud to demo catalog                    |
