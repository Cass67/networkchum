# Console Occupancy Design

## Goal

Make native-console occupancy visible in the UI and provide a safe way to disconnect stale native console clients for a selected node.

## Decision

Add a visible console-status indicator per telnet-backed node and a targeted `Disconnect Native Console` action for the selected node.

## UX

For telnet-backed nodes in the runtime panel:

- show `Console Port: 5004`
- color/status indicates whether the port is free or occupied

Status semantics:

- green: port exists and no external client is attached
- busy color: port exists and an external client is attached
- no status: node has no telnet-backed console

For the selected node when console is occupied:

- `Open Console` stays disabled
- show `Disconnect Native Console`

## Backend

Add a targeted action:

- `POST /labs/:labId/nodes/:nodeId/disconnect-console`

Behavior:

- inspect that node’s `consolePort`
- identify attached external terminal client PIDs
- kill only those client processes
- never kill the QEMU listener itself

## Safety

- selected node only
- terminal client processes only
- no broad lab-wide kill action

## Refresh Behavior

- after disconnect succeeds, refresh runtime state
- busy indicator clears
- `Open Console` becomes available again
