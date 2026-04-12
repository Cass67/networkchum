# Canvas Interaction Design

## Goal

Improve the topology canvas so it supports pan, box selection, multi-node drag, and correct edge-anchored cable labels.

## Decision

Treat these as one canvas interaction package because they all share the same pointer gesture model.

## Interaction Model

### Selection

- Left-drag on empty canvas: box select
- Clicking empty canvas clears selection
- Clicking a node selects it

### Multi-Drag

- Dragging a selected node moves:
  - the single selected node if only one is selected
  - all selected nodes together if multiple are selected

### Pan

- Hold `Space` and drag to pan the canvas

### Cable Labels

- Interface labels at cable ends are anchored from the node rectangle edge
- Labels stay outside the node box on the side of the cable
- Horizontal links: labels sit left/right of node edges
- Vertical links: labels sit above/below node edges

## Why Bundle These

- pan, selection, and drag compete for the same pointer gestures
- cable label placement is part of the same canvas legibility pass
- implementing them together avoids repeated gesture churn

## UX Outcome

- easier navigation on large topologies
- easier bulk layout adjustment
- cleaner link labels that stay readable
