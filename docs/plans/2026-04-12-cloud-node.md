# Cloud Node Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "cloud" device that bridges internal network segments to the host's physical LAN.

**Architecture:** New runtime kind `"cloud"` alongside `"qemu"` and `"container"`. The cloud node has no VM/image/console — it's a pure networking construct. On Linux it bridges the physical NIC into the segment's Linux bridge. On macOS it launches a NAT container. The cloud template has 1-8 interfaces that get cabled to network segments.

**Tech Stack:** TypeScript, Zod, Fastify, Linux ip commands, Docker (for macOS NAT)

---

### Task 1: Add `"cloud"` to the shared runtime schema

**Files:**

- Modify: `packages/shared/src/topology.ts:3`
- Modify: `packages/shared/src/catalog.ts:17`

**Step 1: Update RuntimeKindSchema**

In `packages/shared/src/topology.ts` line 3, change:

```ts
export const RuntimeKindSchema = z.enum(["qemu", "container"]);
```

to:

```ts
export const RuntimeKindSchema = z.enum(["qemu", "container", "cloud"]);
```

**Step 2: Add `"none"` to console enum in catalog schema**

In `packages/shared/src/catalog.ts` line 17, change the console enum:

```ts
console: z.enum(["serial", "vnc"]),
```

to:

```ts
console: z.enum(["serial", "vnc", "none"]),
```

**Step 3: Typecheck**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: PASS (may have new type errors that subsequent tasks fix)

**Step 4: Commit**

```bash
git add packages/shared/src/topology.ts packages/shared/src/catalog.ts
git commit -m "feat: add cloud runtime kind to shared schema"
```

---

### Task 2: Add cloud template

**Files:**

- Modify: `apps/api/src/templates/defaultTemplates.ts`

**Step 1: Add cloud template to the array**

Add before the closing `];` at the end of `defaultTemplates.ts`:

```ts
  {
    id: "cloud",
    runtime: "cloud",
    displayName: "Cloud (External Network)",
    vendor: "NetworkChum",
    boot: {
      console: "none",
      acceleration: "n/a",
    },
    configSchema: {
      ramMb: { default: 0, min: 0, max: 0 },
      vcpu: { default: 0, min: 0, max: 0 },
      interfaceCount: { default: 1, min: 1, max: 8 },
    },
  },
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/templates/defaultTemplates.ts
git commit -m "feat: add cloud device template"
```

---

### Task 3: Include cloud in catalog

**Files:**

- Modify: `apps/api/src/catalog/getCatalog.ts`

**Step 1: Add cloud entries to getCatalog()**

After `containerEntries` (line 45-52) and before the return (line 54), add:

```ts
const cloudEntries = templates
  .filter((template) => template.runtime === "cloud")
  .map((template) => ({
    id: template.id,
    template,
    image: null,
    source: "built-in" as const,
  }));
```

Change the return line from:

```ts
return [...boundVmEntries, ...unboundVmEntries, ...containerEntries];
```

to:

```ts
return [
  ...boundVmEntries,
  ...unboundVmEntries,
  ...containerEntries,
  ...cloudEntries,
];
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/api/src/catalog/getCatalog.ts
git commit -m "feat: include cloud templates in catalog"
```

---

### Task 4: Handle cloud node creation — skip image resolution

**Files:**

- Modify: `apps/api/src/topology/mutations.ts`
- Modify: `apps/api/src/routes/labs.ts`

**Step 1: Update addNode to handle cloud runtime**

In `apps/api/src/topology/mutations.ts`, the `addNode` function generates interfaces. Cloud nodes need the same treatment. No changes needed here — it already uses `template.configSchema.interfaceCount.default` which is 1 for cloud.

However, verify the function doesn't assume qemu/container for acceleration mode. Read the `addNode` function and ensure cloud gets `accelerationMode: "n/a"` passed through correctly.

**Step 2: Skip image resolution for cloud nodes in labs.ts**

In `apps/api/src/routes/labs.ts` lines 215-223, the image resolution block:

```ts
    let resolvedImageId = body.imageId;
    if (!resolvedImageId && template.runtime === "qemu") {
```

This already only triggers for `qemu` runtime. Cloud nodes will skip this block. Good.

Also check the `accelerationMode` block (lines 229-232):

```ts
      accelerationMode:
        template.runtime === "qemu"
          ? acceleration.mode
          : template.boot.acceleration,
```

Cloud will fall into the else branch and get `"n/a"`. Good.

**Step 3: Typecheck**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: PASS

**Step 4: Commit** (only if changes were needed)

```bash
git add apps/api/src/topology/mutations.ts apps/api/src/routes/labs.ts
git commit -m "feat: handle cloud node creation"
```

---

### Task 5: Add cloud power-on/off logic (Linux TAP backend)

**Files:**

- Modify: `apps/api/src/network/reconcileTopology.ts`
- Modify: `apps/api/src/runtime/powerNode.ts`

**Step 1: Extend reconcileTopology for cloud nodes**

In `apps/api/src/network/reconcileTopology.ts`, after the QEMU node loop (line 37-56), add cloud node handling:

```ts
const cloudNodes = document.nodes.filter((node) => node.runtime === "cloud");
const physicalNic = detectPhysicalNic();

for (const node of cloudNodes) {
  if (targetNodeId && node.id !== targetNodeId) continue;

  for (const iface of node.interfaces) {
    const attachment = attachmentByInterfaceId.get(iface.id);
    if (!attachment || !physicalNic) continue;

    operations.push({
      kind: "attach-to-bridge",
      interfaceName: physicalNic,
      bridgeName: bridgeName(attachment.networkId),
    });
  }
}
```

Add a helper function at the top of the file:

```ts
function detectPhysicalNic(): string | null {
  const candidates = ["eth0", "ens192", "ens33", "enp3s0", "enp0s3", "en0"];
  for (const nic of candidates) {
    try {
      require("node:fs").accessSync(`/sys/class/net/${nic}`);
      return nic;
    } catch {
      continue;
    }
  }
  return null;
}
```

**Step 2: Add cloud power-on in powerNode.ts**

In `apps/api/src/runtime/powerNode.ts`, after the container block (line 419) and before the QEMU binary resolution (line 421), add a cloud block:

```ts
if (node.runtime === "cloud") {
  console.log(`[powerNode] activating cloud node ${nodeId} in lab ${labId}`);

  if (getNetworkBackend() === "tap") {
    const ops = reconcileTopology(lab.document, nodeId);
    let ok = true;
    let errorMsg: string | null = null;
    for (const op of ops) {
      const cmd = buildCommand(op);
      if (!cmd) continue;
      const result = await runCommand(cmd[0]!, cmd.slice(1));
      if (!result.ok && !isAlreadyExistsError(result.stderr)) {
        console.warn(`[cloud] ${op.kind}: ${result.stderr.trim()}`);
        ok = false;
        errorMsg = buildNetworkFailureMessage(op.kind, result.stderr, cmd);
      }
    }

    const state = {
      labId,
      nodeId,
      status: ok ? ("running" as const) : ("failed" as const),
      runtime: "cloud" as const,
      accelerationMode: null,
      externalId: ok ? "cloud-tap" : null,
      connectCommand: undefined,
      message: errorMsg,
      commandPreview: [],
      updatedAt: new Date().toISOString(),
    };
    await upsertRuntimeState(state);
    return state;
  }

  // macOS socket backend: NAT container
  const containerName = runtimeName(labId, nodeId);
  const attachments = getNodeAttachmentsForContainer(lab.document, nodeId);

  const networkIds = [...new Set(attachments.map((a) => a.networkId))];
  for (const networkId of networkIds) {
    const createCmd = buildDockerNetworkCreateCommand(networkId);
    await runCommand(createCmd[0]!, createCmd.slice(1));
  }

  const primaryNetwork = attachments[0]
    ? dockerNetworkName(attachments[0].networkId)
    : undefined;

  const spec = buildContainerSpec({
    nodeName: containerName,
    image: "alpine:latest",
    cpu: 1,
    memoryMb: 128,
    network: primaryNetwork,
  });
  console.log("[powerNode] cloud NAT container:", spec.command.join(" "));
  const result = await runCommand(spec.command[0]!, spec.command.slice(1));

  if (result.ok) {
    const containerId = result.stdout.trim() || containerName;
    // Enable NAT inside the container
    const natCommands = [
      [
        "docker",
        "exec",
        containerId,
        "sh",
        "-c",
        "sysctl -w net.ipv4.ip_forward=1",
      ],
      [
        "docker",
        "exec",
        containerId,
        "sh",
        "-c",
        "iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE",
      ],
      [
        "docker",
        "exec",
        containerId,
        "sh",
        "-c",
        "iptables -A FORWARD -i eth0 -o eth1 -j ACCEPT",
      ],
      [
        "docker",
        "exec",
        containerId,
        "sh",
        "-c",
        "iptables -A FORWARD -i eth1 -o eth0 -j ACCEPT",
      ],
    ];
    for (const cmd of natCommands) {
      await runCommand(cmd[0]!, cmd.slice(1));
    }

    for (let i = 1; i < attachments.length; i += 1) {
      const connectCmd = buildDockerNetworkConnectCommand(
        attachments[i]!.networkId,
        containerId,
      );
      await runCommand(connectCmd[0]!, connectCmd.slice(1));
    }
  }

  const state = {
    labId,
    nodeId,
    status: result.ok ? ("running" as const) : ("failed" as const),
    runtime: "cloud" as const,
    accelerationMode: null,
    externalId: result.ok ? result.stdout.trim() || containerName : null,
    connectCommand: undefined,
    message: result.ok ? null : result.stderr,
    commandPreview: spec.command,
    updatedAt: new Date().toISOString(),
  };
  await upsertRuntimeState(state);
  return state;
}
```

**Step 3: Add cloud power-off in powerNode.ts**

In the `powerOffNode` function, after the container power-off block (line 758) and before the QEMU power-off block (line 760), add:

```ts
if (previous?.runtime === "cloud" && previous.status === "running") {
  if (getNetworkBackend() === "tap") {
    // Remove physical NIC from any bridges
    const lab = await getLab(labId);
    if (lab) {
      const node = lab.document.nodes.find((n) => n.id === nodeId);
      if (node) {
        const physicalNic = detectPhysicalNic();
        if (physicalNic) {
          for (const iface of node.interfaces) {
            const attachment = lab.document.attachments.find(
              (a) => a.interfaceId === iface.id,
            );
            if (attachment) {
              const brName = bridgeName(attachment.networkId);
              await runCommand("ip", [
                "link",
                "set",
                "dev",
                physicalNic,
                "nomaster",
              ]).catch(() => {});
            }
          }
        }
      }
    }
  } else {
    // macOS: stop NAT container
    if (previous.externalId) {
      await runCommand("docker", ["stop", previous.externalId]);
      await runCommand("docker", ["rm", "-f", previous.externalId]);
    }
  }
}
```

You'll need to import `bridgeName` and `detectPhysicalNic` from reconcileTopology (or move `bridgeName` to a shared util). Export `bridgeName` and `detectPhysicalNic` from `reconcileTopology.ts`.

**Step 4: Typecheck**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/network/reconcileTopology.ts apps/api/src/runtime/powerNode.ts
git commit -m "feat: cloud node power-on/off with TAP bridge and NAT fallback"
```

---

### Task 6: Update getCatalog filter for cloud runtime

**Files:**

- Modify: `apps/api/src/catalog/getCatalog.ts`

**Step 1: Verify cloud entries appear**

The cloud entries were added in Task 3. Verify the `boundVmEntries` filter (line 16) doesn't accidentally include cloud — it checks `template.runtime !== "qemu"` so cloud is already excluded. Good.

**Step 2: Typecheck and verify**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: PASS

---

### Task 7: Update frontend demo catalog

**Files:**

- Modify: `apps/web/src/App.tsx`

**Step 1: Add cloud to demoCatalog**

In the `demoCatalog` array in `App.tsx`, add:

```ts
  {
    id: "cloud",
    name: "Cloud (External Network)",
    source: "built-in",
    vendor: "NetworkChum",
    runtime: "cloud",
    configSchema: {
      ramMb: { default: 0, min: 0, max: 0 },
      vcpu: { default: 0, min: 0, max: 0 },
      interfaceCount: { default: 1, min: 1, max: 8 },
    },
  },
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: PASS

**Step 3: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: add cloud to frontend demo catalog"
```

---

### Task 8: Final verification

**Step 1: Full typecheck**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json && npx tsc --noEmit -p apps/web/tsconfig.json`
Expected: PASS

**Step 2: Verify cloud template is in the registry**

Run: `node -e "const {defaultTemplates} = require('./apps/api/src/templates/defaultTemplates.ts'); console.log(defaultTemplates.find(t => t.id === 'cloud'))"` (or just grep the file)

**Step 3: Manual smoke test**

1. Start the app
2. Open the device catalog — cloud should appear
3. Drag cloud onto the canvas
4. Cable a VM's interface to the same network as the cloud node
5. Power on both — VM should get a LAN IP (Linux) or NAT access (macOS)
