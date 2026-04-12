// Linux interface names are limited to 15 chars (IFNAMSIZ=16 including NUL).
// Use the LAST 4 alphanumeric chars of each ID so the unique suffix is kept.
// Format: tap-LLLL-NNNN-I = 15 chars for single-digit index.
function shortSuffix(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9]/g, "");
  return clean.slice(-4).padStart(4, "0");
}

export function tapName(labId: string, nodeId: string, index: number): string {
  return `tap-${shortSuffix(labId)}-${shortSuffix(nodeId)}-${index}`;
}

type BuildQemuCommandInput = {
  labId: string;
  nodeId: string;
  imagePath: string;
  extraDrives?: string[]; // additional disk/cdrom paths, attached as ide drives
  extraArgs?: string[]; // raw QEMU args appended after all drives (for config injectors)
  machineType: string;
  config: {
    ramMb: number;
    vcpu: number;
    interfaceCount: number;
    nicModel?: string;
    accelerationMode?: string;
  };
  // On macOS (socket backend) each NIC listens on its own port so the
  // virtual switch can connect and forward frames without a VM restart.
  // nicPorts[i] = listen port for NIC index i.
  nicPorts?: number[];
  networkBackend?: "tap" | "socket";
};

export function buildQemuCommand(input: BuildQemuCommandInput): string[] {
  const backend = input.networkBackend ?? "tap";
  const command = [
    "qemu-system-x86_64",
    "-machine",
    input.machineType,
    "-cpu",
    "max",
    "-m",
    String(input.config.ramMb),
    "-smp",
    String(input.config.vcpu),
    // Boot from hard disk first. Without strict=on SeaBIOS falls through
    // non-bootable drives (e.g. a day-0 FAT config disk on IDE) and lands
    // on the virtio OS disk.
    "-boot",
    "order=c",
    "-drive",
    `file=${input.imagePath},if=virtio,format=qcow2`,
  ];

  for (const extraPath of input.extraDrives ?? []) {
    const isIso = extraPath.endsWith(".iso");
    if (isIso) {
      command.push("-drive", `file=${extraPath},media=cdrom,readonly=on`);
    } else {
      command.push("-drive", `file=${extraPath},if=ide,format=qcow2`);
    }
  }

  for (const arg of input.extraArgs ?? []) {
    command.push(arg);
  }

  if (
    input.config.accelerationMode &&
    input.config.accelerationMode !== "none" &&
    input.config.accelerationMode !== "n/a" &&
    input.config.accelerationMode !== "tcg"
  ) {
    command.push("-accel", input.config.accelerationMode);
  }

  for (let index = 0; index < input.config.interfaceCount; index += 1) {
    const nicModel = input.config.nicModel ?? "virtio-net-pci";

    if (backend === "tap") {
      const name = tapName(input.labId, input.nodeId, index);
      command.push(
        "-netdev",
        `tap,id=net${index},ifname=${name},script=no,downscript=no`,
        "-device",
        `${nicModel},netdev=net${index}`,
      );
    } else {
      // Socket backend: each NIC listens on its own dedicated port so the
      // in-process virtual switch can connect and route frames dynamically.
      const port = input.nicPorts?.[index];
      if (port !== undefined) {
        command.push(
          "-netdev",
          `socket,id=net${index},listen=127.0.0.1:${port}`,
          "-device",
          `${nicModel},netdev=net${index}`,
        );
      } else {
        // Fallback: unconnected user-mode (should not happen in practice).
        command.push(
          "-netdev",
          `user,id=net${index},restrict=on`,
          "-device",
          `${nicModel},netdev=net${index}`,
        );
      }
    }
  }

  return command;
}
