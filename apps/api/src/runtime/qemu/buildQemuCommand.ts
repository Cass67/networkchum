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

type ExplicitNicBackend =
  | { kind: "tap" }
  | { kind: "socket"; port: number }
  | { kind: "macos-management" };

type ComputedNicBackend =
  | { kind: "tap" }
  | { kind: "socket"; port?: number }
  | { kind: "macos-management" };

type BuildQemuCommandInput = {
  qemuBinary?: string;
  labId: string;
  nodeId: string;
  imagePath: string;
  extraDrives?: string[]; // additional disk/cdrom paths, attached as ide drives
  extraArgs?: string[]; // raw QEMU args appended after all drives (for config injectors)
  mainDiskInterface?: "virtio" | "ide" | "sata"; // default: virtio
  machineType: string;
  // UEFI firmware image (OVMF). Required when firmware is "uefi".
  firmware?: "bios" | "uefi";
  uefiFirmwarePath?: string;
  cpuModel?: string;
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
  nicBackends?: ExplicitNicBackend[];
  networkBackend?: "tap" | "socket";
};

export function buildQemuCommand(input: BuildQemuCommandInput): string[] {
  const defaultBackend: "tap" | "socket" = input.networkBackend ?? "tap";
  const command = [
    input.qemuBinary ?? "qemu-system-x86_64",
    "-machine",
    input.machineType,
    "-cpu",
    input.cpuModel ?? "max",
    "-m",
    String(input.config.ramMb),
    "-smp",
    String(input.config.vcpu),
  ];

  if (input.firmware === "uefi") {
    if (!input.uefiFirmwarePath) {
      throw new Error(
        "UEFI firmware requested but no OVMF image was found (install ovmf)",
      );
    }
    command.push("-bios", input.uefiFirmwarePath);
  }

  const diskInterface = input.mainDiskInterface ?? "virtio";
  if (diskInterface === "sata") {
    // Cisco NX-OSv 9000 boots from an AHCI-attached disk; virtio and IDE both
    // fail (no serial output, then a kernel panic with IDE).
    const pciBus = input.machineType.startsWith("q35") ? "pcie.0" : "pci.0";
    command.push(
      "-device",
      `ahci,id=ahci0,bus=${pciBus}`,
      "-drive",
      `file=${input.imagePath},if=none,id=maindisk,format=qcow2`,
      "-device",
      `ide-hd,bus=ahci0.0,drive=maindisk,id=maindisk0,bootindex=1`,
    );
  } else {
    command.push(
      "-drive",
      `file=${input.imagePath},if=${diskInterface},format=qcow2`,
    );
  }

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
    const explicitBackend = input.nicBackends?.[index];
    const backend: ComputedNicBackend =
      explicitBackend ??
      (defaultBackend === "socket"
        ? { kind: "socket", port: input.nicPorts?.[index] }
        : { kind: "tap" });

    switch (backend.kind) {
      case "tap": {
        const name = tapName(input.labId, input.nodeId, index);
        command.push(
          "-netdev",
          `tap,id=net${index},ifname=${name},script=no,downscript=no`,
          "-device",
          `${nicModel},netdev=net${index}`,
        );
        break;
      }
      case "macos-management": {
        command.push(
          "-netdev",
          `vmnet-host,id=net${index}`,
          "-device",
          `${nicModel},netdev=net${index}`,
        );
        break;
      }
      case "socket": {
        if (backend.port !== undefined) {
          command.push(
            "-netdev",
            `socket,id=net${index},listen=127.0.0.1:${backend.port}`,
            "-device",
            `${nicModel},netdev=net${index}`,
          );
        } else {
          command.push(
            "-netdev",
            `user,id=net${index},restrict=on`,
            "-device",
            `${nicModel},netdev=net${index}`,
          );
        }
        break;
      }
      default:
        throw new Error("Unexpected NIC backend");
    }
  }

  return command;
}
