# NetworkChum Design

## Goal

Build a browser-based network lab platform in the EVE-NG / PNETLab / GNS3 category with a clean architecture and no artificial restriction on connecting or disconnecting cables while nodes are powered on.

V1 should:

- Boot QEMU/KVM network device images from `qcow2`
- Boot generic Linux VMs from `qcow2`
- Run Linux utility containers for lightweight endpoints and services
- Discover images from a filesystem-backed library
- Present a device catalog and add-node flow in the web UI
- Let users build, save, load, and operate topologies in the browser
- Allow live cable connect/disconnect on running nodes
- Pass through host CPU virtualization acceleration to VM nodes

V1 should feel familiar to EVE-NG / PNETLab users while using a better native persistence format and a cleaner internal runtime model.

## Product Principles

1. Live topology edits should not depend on paid tiers or guest-specific hot-plug quirks.
2. The system should treat VMs and containers as first-class node runtimes behind a shared topology model.
3. The topology model should support both point-to-point links and shared Ethernet segments.
4. The storage and API model should be JSON-native, with compatibility import/export added separately.
5. The MVP should be single-host Linux first, but the runtime boundaries should preserve a later path to controller/worker architecture.

## Product Shape

### Core User Experience

Users should be able to:

- Drop supported images into a configured images directory
- Scan and classify those images into a device catalog
- Choose a device from `Add Node`
- Configure RAM, vCPU, interface count, and similar runtime parameters
- Place the node onto a canvas
- Connect and disconnect cables while nodes are running
- Open browser consoles for nodes
- Save and reload labs

### Competitive Baseline

Based on the public behavior of EVE-NG, PNETLab, and GNS3, v1 should target parity in these areas:

- Canvas-first topology authoring
- Device catalog and add-node flow
- HTML5 console access
- Folder/lab management
- Persistent annotations and basic canvas metadata
- Import/export-ready lab model

V1 does not need full parity for:

- clustering
- distributed workers
- enterprise RBAC
- snapshots and image cloning workflows
- background images or workbooks unless inexpensive to add

## Architecture

### Deployment Model

V1 targets a single Linux host running:

- web frontend
- API/controller
- runtime managers
- network manager
- persistent storage

The single-host boundary is an implementation detail. Internally, the controller should call runtime and network adapters through interfaces that can later target remote workers.

### Major Components

1. Web UI

- Device catalog
- Add/edit node forms
- Topology canvas
- Console tabs/windows
- Lab browser

2. API / Controller

- Authentication
- Labs, nodes, links, images, templates CRUD
- Power and wiring actions
- Runtime state reporting
- Desired-state reconciliation

3. Image Service

- Scan configured image directories
- Discover `qcow2` and container templates
- Compute metadata and hashes
- Bind disk images to boot templates

4. Template Service

- Holds vendor/platform definitions
- Defines defaults, limits, console type, machine type, NIC model, boot args

5. Runtime Service

- `QEMU adapter` for VM nodes
- `Container adapter` for Linux utility nodes
- Tracks process/container lifecycle and status

6. Network Service

- Creates and tears down TAP devices, bridges, veth pairs, namespaces as needed
- Rewires topology live
- Supports shared segments and external/NAT connections later

7. Persistence Layer

- Database for metadata and desired state
- Filesystem storage for images and lab artifacts

## Runtime Model

### Node Runtime Kinds

V1 supports:

- `qemu` for network appliance VMs and generic Linux VMs
- `container` for Linux utility nodes

The UI should present both in the same catalog, but runtime execution is delegated by node type.

### VM Model

Each VM node resolves from:

- image
- template
- node instance config

Configurable per node:

- name
- RAM in MB
- vCPU count
- interface count
- NIC model, if exposed by template
- CPU acceleration mode, with hardware acceleration enabled by default on supported hosts
- optional boot args or secondary files if supported by template

For v1, hardware inventory changes should only be allowed before first boot or while powered off.

### CPU Acceleration

V1 should use hardware virtualization acceleration for VM nodes whenever the host supports it.

Requirements:

- QEMU nodes should launch with host acceleration enabled on supported hosts
- Linux production hosts should use `KVM`
- the runtime should validate host acceleration capability during startup
- templates may opt out only if a specific image is known to require pure emulation
- the UI should expose whether a node is using accelerated or fallback execution

For v1, this should be treated as a host/runtime capability first, not an advanced tuning feature. The default expectation is that appliance and Linux VM workloads run with hardware acceleration passed through to the guest runtime. On Linux this means `KVM`. Other acceleration modes, such as `HVF` for Apple Silicon/macOS development, should remain possible within the runtime abstraction but are not required for v1 production scope.

### Container Model

Containers are lightweight Linux utility nodes such as:

- Alpine
- Ubuntu
- Debian
- BusyBox
- network tools images

Configurable per container node:

- image tag
- CPU limit
- RAM limit
- interface count
- startup command/profile

Containers use the same topology engine and live cable behavior as VMs.

## Topology Model

### Core Choice

Use JSON natively, but keep topology semantics close to EVE-NG / PNETLab:

- nodes
- interfaces
- networks or segments
- attachments

Do not model persistence as only explicit pairwise links. Pairwise cables in the UI should be a rendering of interface attachments to a hidden network/segment where appropriate.

This matches the actual Linux networking backend and cleanly supports:

- point-to-point links
- shared Ethernet segments
- hidden bridge objects
- future NAT/cloud/external nodes

### Native Lab Document

Example shape:

```json
{
  "id": "lab-123",
  "name": "branch-test",
  "version": 1,
  "canvas": {
    "zoom": 1,
    "backgroundImage": null
  },
  "nodes": [
    {
      "id": "node-r1",
      "name": "R1",
      "runtime": "qemu",
      "templateId": "cisco-asr",
      "imageId": "img-asr-01",
      "position": { "x": 320, "y": 180 },
      "config": {
        "vcpu": 4,
        "ramMb": 8192,
        "interfaceCount": 8,
        "nicModel": "virtio"
      },
      "state": {
        "desiredPower": "off"
      },
      "interfaces": [
        { "id": "if-r1-0", "name": "Gi0/0", "slot": 0 },
        { "id": "if-r1-1", "name": "Gi0/1", "slot": 1 }
      ]
    }
  ],
  "networks": [
    {
      "id": "net-12",
      "kind": "ethernet",
      "name": "R1-R2",
      "visible": false
    }
  ],
  "attachments": [
    { "interfaceId": "if-r1-0", "networkId": "net-12" },
    { "interfaceId": "if-r2-0", "networkId": "net-12" }
  ],
  "annotations": [],
  "startupConfigSets": []
}
```

### Compatibility

The platform should be designed so `.unl` XML import/export can be added later. Native storage remains JSON.

## Live Cable Semantics

### Design Rule

Live connect/disconnect must work independently of node power state.

To achieve that:

- interface inventory is stable while the node is running
- cable operations mutate host-side connectivity only
- cable operations do not add or remove guest virtual NIC hardware

### Host-Side Representation

Each node interface gets a stable host-side endpoint:

- VM: TAP device
- container: veth or namespace-attached endpoint

Examples:

- `tap-lab123-r1-0`
- `tap-lab123-r1-1`

Cable operations then:

- attach an endpoint to a bridge/segment
- detach an endpoint from a bridge/segment
- move an endpoint to an isolated bridge

This provides live rewiring without relying on guest OS support for NIC hot-plug or hot-unplug.

### Editing Rules

Allowed anytime:

- connect cable
- disconnect cable
- move cable to another segment
- interface admin or link-state operations if exposed

Allowed only while powered off:

- change interface count
- change RAM
- change vCPU
- change boot-time NIC model or machine type

## Image Library and Catalog

### Image Directory

V1 uses a configured image directory, for example:

- `/opt/networkchum/images/`

Operators place `qcow2` files there. The backend scans the directory and creates image records.

### Separation of Concerns

Three layers are required:

1. Image

- raw boot asset on disk

2. Template

- platform recipe and defaults

3. Catalog Entry / Node Instance

- what users see and instantiate in the UI

This allows multiple templates or runtime profiles to refer to the same disk image if needed.

### Template-Driven Catalog

The add-node form should be driven by template metadata rather than hardcoded per vendor.

V1 should ship with a built-in template library. Templates are authored by NetworkChum and stored in the product repository. Discovered images are then bound to one of those templates by the operator.

Recommended v1 workflow:

- ship a curated set of built-in templates
- scan the image directory for `qcow2` files
- suggest a template from filename patterns where possible
- require the user to confirm or assign the template
- persist the image-to-template binding in the database

Examples:

- `cisco-asr`
- `cisco-nxosv`
- `juniper-vsrx`
- `linux-generic-vm`
- `linux-alpine-container`

Each template defines:

- runtime kind
- defaults
- min/max validation
- console type
- machine type
- NIC naming strategy
- boot arguments

### Initial Built-In Templates

V1 should start with a small curated template library rather than trying to support every appliance from day one.

Recommended initial VM templates:

1. `linux-generic-vm`

- Purpose: known-good baseline for general Linux guests
- Runtime: `qemu`
- Disk: `qcow2`
- Defaults: `2 vCPU`, `2048 MB RAM`, `2 interfaces`
- NIC model: `virtio-net`
- Console: serial preferred
- Notes: use this as the validation target for the first complete VM path

2. `cisco-asr`

- Purpose: ASR / IOS-XE-style router image profile
- Runtime: `qemu`
- Defaults: `4 vCPU`, `8192 MB RAM`, `8 interfaces`
- NIC model: template-selected based on tested compatibility
- Console: serial or telnet-style serial presentation in browser
- Notes: this template is for curated, tested ASR-compatible image variants only

3. `cisco-nxosv`

- Purpose: virtual Nexus switch profile
- Runtime: `qemu`
- Defaults: `4 vCPU`, `8192 MB RAM`, `8 interfaces`
- NIC model: template-selected based on tested compatibility
- Console: serial first, VNC fallback if required by the image
- Notes: likely to need tighter boot recipe control than generic Linux

4. `juniper-vsrx`

- Purpose: Juniper virtual firewall/router profile
- Runtime: `qemu`
- Defaults: `2-4 vCPU`, `4096-8192 MB RAM`, `6-8 interfaces`
- NIC model: template-selected based on tested compatibility
- Console: serial preferred
- Notes: start with one validated image family rather than all Juniper variants

Recommended initial container templates:

5. `linux-alpine-container`

- Purpose: lightweight endpoint and test node
- Runtime: `container`
- Defaults: `1 vCPU`, `256 MB RAM`, `1-2 interfaces`

6. `linux-ubuntu-container`

- Purpose: richer endpoint / utility host
- Runtime: `container`
- Defaults: `1 vCPU`, `512 MB RAM`, `1-2 interfaces`

7. `linux-nettools-container`

- Purpose: troubleshooting image with tools like `ping`, `curl`, `iperf`, `tcpdump`
- Runtime: `container`
- Defaults: `1 vCPU`, `512 MB RAM`, `1-4 interfaces`

This initial set gives v1:

- one stable generic VM target
- a first set of network appliance templates matching the intended market
- lightweight utility endpoints for labs

### Template Source and Ownership

V1 template sources should be:

1. Built-in templates

- stored in the repository
- versioned with the product
- used as the primary supported template set

2. User-assigned image bindings

- stored in the database
- map a discovered image to a chosen built-in template

3. User-authored custom templates

- optional later feature
- can be added after the built-in catalog flow is stable

V1 should not depend on automatic image introspection to generate templates. At most, filename heuristics can suggest likely matches.

## Web UI

### Required V1 Views

1. Device Catalog

- filter by vendor/type/runtime
- show discovered images and container templates
- support `Add Node`

2. Add/Edit Node Modal

- node name
- template/image
- RAM
- vCPU
- interface count
- NIC model where relevant

3. Topology Canvas

- drag/drop nodes
- cable tool
- node status display
- context actions
- basic annotations

4. Console Experience

- browser-native console tabs/windows
- serial first, VNC when needed

5. Lab Browser

- create/open/save/rename/delete labs
- folder organization

### UX Goal

The canvas should feel familiar to EVE-NG / PNETLab / GNS3 users without inheriting their licensing restrictions.

## Persistence and APIs

### Database Responsibility

The database stores:

- labs
- nodes
- interfaces
- networks
- attachments
- templates
- images
- runtime state metadata
- audit/event history if added later

### Filesystem Responsibility

Filesystem stores:

- `qcow2` images
- optional per-node artifacts
- exported configs and snapshots later

### API Style

V1 can use a straightforward REST or JSON-over-HTTP API.

Essential operations:

- scan images
- list templates/catalog entries
- create/update/delete labs
- add/update/delete nodes
- connect/disconnect interfaces
- power on/off nodes
- open console sessions
- query runtime state

## Failure Handling and Reconciliation

This category of product fails in partial ways often. The controller must assume host operations can fail midway.

Required behaviors:

- link operations should be transactional
- failed boot should not leave orphan TAPs or zombie processes
- console failure should not imply node failure
- image scan failure should quarantine the bad entry
- runtime state should distinguish `starting`, `running`, `stopped`, `failed`, `wiring-error`
- hosts missing required acceleration support should fail clearly for templates that require it

The controller should run a periodic reconciler that compares desired state with actual host state:

- expected QEMU processes
- expected containers
- expected TAP/veth/bridge membership
- stale artifacts from interrupted operations

This reconciler is a core MVP capability, not optional polish.

## External Connectivity

Not all of this needs to ship in v1, but the topology model should allow:

- shared Ethernet segments
- NAT/cloud nodes
- host uplinks / bridged external connections
- packet capture later

These are easier to add if networks/segments are first-class objects from day one.

## Supported V1 Scope

### Included

- Linux-only single-host deployment
- `qcow2` VM images
- generic Linux VMs
- selected network appliance VM templates
- Linux utility containers
- hardware acceleration for VM nodes on supported hosts, with `KVM` as the Linux target
- image directory scan
- template-driven catalog
- add-node forms with editable RAM/CPU/interface count
- browser console
- save/load labs
- live connect/disconnect of cables

### Deferred

- clustering / remote workers
- HA control plane
- enterprise RBAC
- advanced snapshots and full image cloning workflows
- true runtime NIC hot-plug/hot-unplug
- broad auto-detection of arbitrary vendor images
- Wireshark integration
- workbook/PDF features

## V1 Acceptance Criteria

The MVP is successful when it can prove all of the following:

1. Image discovery

- dropping a `qcow2` into the image directory produces a visible catalog entry after scan

2. Node creation

- a Linux VM can be created with custom RAM, CPU, and interface count
- a network appliance VM can be created from a supported template
- a Linux utility container can be created from the same catalog model

3. Boot and console

- nodes boot successfully
- browser console opens and remains usable
- VM launch paths enable host acceleration on supported hosts and report capability errors clearly otherwise

4. Live topology edits

- two running nodes can be connected
- the cable can be disconnected while they remain powered on
- the interface can be reconnected elsewhere without node reboot

5. Persistence

- lab layout and topology survive reload/restart

6. Recovery

- interrupted boot or wiring operations do not leave the host in an inconsistent state

## Roadmap

### V1

- Single-host Linux deployment
- VMs plus Linux utility containers
- JSON-native lab format
- Image scan and template-driven catalog
- Browser topology editor and consoles
- Live cable connect/disconnect

### V2

- Better template library
- snapshots and startup config sets
- external connectivity options
- richer annotations and backgrounds
- basic multi-user / permissions
- `.unl` import/export

### V3

- Controller/worker split
- scheduler and worker agents
- shared image distribution
- stronger tenancy and quotas
- production-grade operations and observability

## Recommendation

Build NetworkChum as a JSON-native, segment-based topology platform with separate runtime adapters for QEMU and containers. Use stable interface endpoints and host-side rewiring to guarantee live cable operations on running nodes. Match the familiar EVE-NG / PNETLab workflow in the web UI, but avoid copying their legacy storage model or feature gating.
