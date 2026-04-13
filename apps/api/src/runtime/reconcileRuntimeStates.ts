import { isQemuProcessCommandLine } from "./qemu/resolveQemuBinary.js";
import {
  listRuntimeStates,
  type RuntimeState,
  upsertRuntimeState,
} from "./runtimeStateStore.js";

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

type RunCommand = (command: string, args: string[]) => Promise<CommandResult>;

function stopState(state: RuntimeState, message: string): RuntimeState {
  return {
    ...state,
    status: "stopped",
    externalId: null,
    connectCommand: undefined,
    consolePort: null,
    nicPorts: undefined,
    message,
    updatedAt: new Date().toISOString(),
  };
}

async function isContainerRunning(
  externalId: string,
  runCommand: RunCommand,
): Promise<boolean | null> {
  const result = await runCommand("docker", [
    "inspect",
    "-f",
    "{{.State.Running}}",
    externalId,
  ]);

  if (!result.ok) {
    return null;
  }

  const state = result.stdout.trim();
  if (state === "true") {
    return true;
  }
  if (state === "false") {
    return false;
  }

  return null;
}

async function reconcileRuntimeState(
  state: RuntimeState,
  runCommand: RunCommand,
): Promise<RuntimeState> {
  if (state.status !== "running") {
    return state;
  }

  if (state.runtime === "qemu") {
    if (!state.externalId) {
      return stopState(state, "QEMU process was not found on this host.");
    }

    const result = await runCommand("ps", [
      "-p",
      state.externalId,
      "-o",
      "command=",
    ]);
    const commandLine = `${result.stdout} ${result.stderr}`;
    if (!result.ok || !isQemuProcessCommandLine(commandLine)) {
      return stopState(state, "QEMU process was not found on this host.");
    }

    return state;
  }

  if (state.runtime === "container") {
    if (!state.externalId) {
      return stopState(state, "Container is not running on this host.");
    }

    const isRunning = await isContainerRunning(state.externalId, runCommand);
    if (isRunning === false) {
      return stopState(state, "Container is not running on this host.");
    }

    return state;
  }

  if (state.externalId === "cloud-tap") {
    return state;
  }

  if (state.externalId && state.externalId !== "cloud-tap") {
    const isRunning = await isContainerRunning(state.externalId, runCommand);
    if (isRunning !== false) {
      return state;
    }
  }

  return stopState(state, "Cloud uplink state was cleared after host restart.");
}

export async function reconcileRuntimeStates(
  labId: string | undefined,
  runCommand: RunCommand,
): Promise<RuntimeState[]> {
  const states = await listRuntimeStates(labId);
  const nextStates = await Promise.all(
    states.map((state) => reconcileRuntimeState(state, runCommand)),
  );

  for (let index = 0; index < states.length; index += 1) {
    const previous = states[index]!;
    const next = nextStates[index]!;
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      await upsertRuntimeState(next);
    }
  }

  return nextStates;
}
