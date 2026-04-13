import { mkdir, readFile, writeFile } from "node:fs/promises";
import { getDataDir, getDataFile } from "../storagePaths.js";

function runtimeFile(): string {
  return getDataFile("runtime-states.json");
}

export type RuntimeState = {
  labId: string;
  nodeId: string;
  status: "running" | "stopped" | "failed";
  runtime: "qemu" | "container" | "cloud";
  accelerationMode: string | null;
  externalId?: string | null;
  // For cloud nodes, disambiguate non-container backends (linux TAP, macOS host-only management)
  // from the NAT-helper container fallback. This allows reconciliation/power-off logic to behave
  // correctly even when externalId is null (macOS host-only).
  cloudBackend?: "tap" | "container-nat" | "macos-management";
  connectCommand?: string[];
  consolePort?: number | null;
  nicPorts?: number[];
  // Per-NIC backend hints for socket topology rebuild. On macOS, management NICs
  // use vmnet-host and should not be registered as socket ports.
  // Slots not explicitly overridden are stored as null.
  nicBackends?: Array<"macos-management" | null>;
  message?: string | null;
  commandPreview: string[];
  updatedAt: string;
};

async function ensureStore(): Promise<void> {
  await mkdir(getDataDir(), { recursive: true });
}

export async function listRuntimeStates(
  labId?: string,
): Promise<RuntimeState[]> {
  try {
    const raw = await readFile(runtimeFile(), "utf8");
    const states = JSON.parse(raw) as RuntimeState[];
    return labId ? states.filter((state) => state.labId === labId) : states;
  } catch {
    return [];
  }
}

async function saveRuntimeStates(states: RuntimeState[]): Promise<void> {
  await ensureStore();
  await writeFile(runtimeFile(), JSON.stringify(states, null, 2));
}

export async function upsertRuntimeState(
  nextState: RuntimeState,
): Promise<void> {
  const states = await listRuntimeStates();
  const index = states.findIndex(
    (state) =>
      state.labId === nextState.labId && state.nodeId === nextState.nodeId,
  );

  if (index >= 0) {
    states[index] = nextState;
  } else {
    states.push(nextState);
  }

  await saveRuntimeStates(states);
}

export async function deleteRuntimeState(
  labId: string,
  nodeId: string,
): Promise<void> {
  const states = await listRuntimeStates();
  await saveRuntimeStates(
    states.filter(
      (state) => !(state.labId === labId && state.nodeId === nodeId),
    ),
  );
}
