# Node-Level Cable Flow Design

## Goal

Simplify wiring for dense devices by removing per-port labels from the canvas and replacing port-click wiring with a node-level cable workflow.

## Decision

Use node-level cable creation:

- right-click source node -> `Add Cable`
- drag to destination node
- choose source/destination interfaces in a dialog

## UX

### Canvas

- node cards no longer render interface labels or visible interface ports underneath
- links remain visually as they are today

### Cable Creation

- right-click a node -> `Add Cable`
- enters cable mode from that source node
- drag toward destination node
- release on destination node -> open `Add Cable` dialog

### Cable Dialog

- `Source Node` (read-only)
- `Destination Node` (read-only)
- `Source Interface` dropdown
- `Destination Interface` dropdown
- defaults may preselect first free interface on each side

Actions:

- `Cancel`
- `Create Cable`

## Cancellation

- `Esc` cancels cable mode
- clicking empty canvas cancels cable mode
- dropping on the same node cancels

## Context Menus

- preserve existing disconnect/delete actions
- add `Add Cable` only on node context menu

## Backend

- no new wiring model needed
- reuse existing:
  - create network
  - attach both interfaces

## Benefit

- dense devices with 8-16+ interfaces stay readable
- admin intent stays explicit because interface selection still happens before cable creation
