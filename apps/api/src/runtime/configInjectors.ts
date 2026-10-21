import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Returns additional QEMU args needed to attach the config drive.
export type ConfigInjector = (
  config: string,
  outputPath: string,
) => Promise<string[]>;

// --- cloud-init (nocloud) ---
// Creates a cidata ISO containing meta-data + user-data.
// Works with any Linux VM that has cloud-init installed.
// The startup config is written to /etc/startup-config on first boot.
export async function injectCloudInit(
  config: string,
  outputPath: string,
): Promise<string[]> {
  const tmpDir = await makeTempDir();
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });

    const metaData =
      "instance-id: networkchum\nlocal-hostname: networkchum-node\n";
    const userDataLines = [
      "#cloud-config",
      "write_files:",
      "  - path: /etc/startup-config",
      `    encoding: b64`,
      `    content: ${Buffer.from(config).toString("base64")}`,
      "    permissions: '0644'",
    ];

    await writeFile(path.join(tmpDir, "meta-data"), metaData, "utf8");
    await writeFile(
      path.join(tmpDir, "user-data"),
      userDataLines.join("\n") + "\n",
      "utf8",
    );

    if (process.platform === "darwin") {
      await execFileAsync("hdiutil", [
        "makehybrid",
        "-iso",
        "-joliet",
        "-default-volume-name",
        "cidata",
        "-o",
        outputPath,
        tmpDir,
      ]);
    } else {
      const tool = await resolveIsoTool();
      await execFileAsync(tool, [
        "-o",
        outputPath,
        "-V",
        "cidata",
        "-r",
        "-J",
        tmpDir,
      ]);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  return ["-drive", `file=${outputPath},media=cdrom,readonly=on`];
}

// --- Cisco CSR1000v (IOS-XE) vfat ---
// Same mechanism as IOSv but IOS-XE looks for `iosxe_config.txt` not `startup-config`.
// The day-0 disk is attached only when the user queues an explicit
// `inject-once` boot action with a non-empty startup config, so normal power
// cycles keep previously saved NVRAM intact.
export async function injectCsr1000vConfigDrive(
  config: string,
  outputPath: string,
): Promise<{
  layout: "csr1000v-vfat";
  outputPath: string;
  payloadFile: "iosxe_config.txt";
  qemuArgs: ["-drive", string];
}> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const tmpConfig = path.join(os.tmpdir(), `nc-csr-cfg-${Date.now()}.txt`);
  try {
    await writeFile(tmpConfig, config, "utf8");
    // 1 MB → FAT12 (EVE-NG default). IOS-XE day-0 scanner accepts FAT12.
    await execFileAsync("dd", [
      "if=/dev/zero",
      `of=${outputPath}`,
      "bs=1024",
      "count=1024",
    ]);
    await execFileAsync("mformat", ["-i", outputPath, "-v", "config-1", "::"]);
    await execFileAsync("mcopy", [
      "-i",
      outputPath,
      tmpConfig,
      "::iosxe_config.txt",
    ]);
  } finally {
    await rm(tmpConfig, { force: true });
  }

  // EVE-NG approach: config disk on virtio so SeaBIOS ignores it as a boot
  // target; main disk is IDE so BIOS boots from it first.
  return {
    layout: "csr1000v-vfat",
    outputPath,
    payloadFile: "iosxe_config.txt",
    qemuArgs: ["-drive", `file=${outputPath},if=virtio,format=raw`],
  };
}

export async function injectCsr1000vVfat(
  config: string,
  outputPath: string,
): Promise<string[]> {
  const configDrive = await injectCsr1000vConfigDrive(config, outputPath);
  return [...configDrive.qemuArgs];
}

// --- Juniper vMX / vJunos (junos-config-disk) ---
// Junos images accept day-0 config from a second disk containing
// `boot/juniper.conf` (the convention used by Juniper's make-config.sh and
// vrnetlab's metadata disk; also verified against vMX metadata images).
// We also drop a root-level copy for images that scan the filesystem root.
// Requires mtools (mformat + mmd + mcopy).
export async function injectJunosConfigDisk(
  config: string,
  outputPath: string,
): Promise<string[]> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const tmpConfig = path.join(os.tmpdir(), `nc-junos-cfg-${Date.now()}.conf`);
  try {
    await writeFile(tmpConfig, config, "utf8");
    // 10 MB FAT image, same as Juniper's make-config.sh metadata disk.
    await execFileAsync("dd", [
      "if=/dev/zero",
      `of=${outputPath}`,
      "bs=1024",
      "count=10240",
    ]);
    await execFileAsync("mformat", ["-i", outputPath, "::"]);
    await execFileAsync("mmd", ["-i", outputPath, "::/boot"]);
    await execFileAsync("mcopy", [
      "-i",
      outputPath,
      tmpConfig,
      "::/boot/juniper.conf",
    ]);
    await execFileAsync("mcopy", [
      "-i",
      outputPath,
      tmpConfig,
      "::/juniper.conf",
    ]);
  } finally {
    await rm(tmpConfig, { force: true });
  }

  // Main disk is forced to IDE (hda) so the config disk lands at hdb —
  // matching the EVE-NG / make-config.sh convention.
  return ["-drive", `file=${outputPath},format=raw,if=ide,index=0,unit=1`];
}

// --- Cisco IOSv vfat ---
// Creates a small raw FAT image containing startup-config.
// IOSv reads this disk on boot as its NVRAM startup config.
// Requires mtools (mformat + mcopy) — brew install mtools / apt install mtools.
export async function injectIosvVfat(
  config: string,
  outputPath: string,
): Promise<string[]> {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const tmpConfig = path.join(os.tmpdir(), `nc-iosv-cfg-${Date.now()}.txt`);
  try {
    await writeFile(tmpConfig, config, "utf8");

    // Create a 1 MB empty image and format as FAT
    await execFileAsync("dd", [
      "if=/dev/zero",
      `of=${outputPath}`,
      "bs=1024",
      "count=1024",
    ]);
    await execFileAsync("mformat", ["-i", outputPath, "::"]);
    await execFileAsync("mcopy", [
      "-i",
      outputPath,
      tmpConfig,
      "::startup-config",
    ]);
  } finally {
    await rm(tmpConfig, { force: true });
  }

  // IOSv expects this on a virtio drive (matches EVE-NG wrapper behaviour)
  return ["-drive", `file=${outputPath},if=virtio,format=raw`];
}

// --- Arista vEOS flash ---
// Writes startup-config into the vEOS flash partition (partition 2, ext2/ext4)
// inside the main overlay disk.
//
// Requires: qemu-img (already needed) + debugfs from e2fsprogs
//   macOS:  brew install e2fsprogs
//   Linux:  apt install e2fsprogs
//
// Process:
//   1. Read MBR to find partition 2 byte offset (works across vEOS versions)
//   2. Convert overlay qcow2 → sparse raw (APFS punches holes for zero regions)
//   3. Run debugfs with `file.raw?offset=N` to write directly into partition 2
//      without extracting the 4GB partition into a separate file
//   4. Convert modified raw → qcow2 and atomically replace overlay

export async function injectVeosFlash(
  config: string,
  overlayDiskPath: string,
): Promise<void> {
  const dir = path.dirname(overlayDiskPath);
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const tmpMbr = path.join(dir, `nc-mbr-${tag}.bin`);
  const tmpRaw = path.join(dir, `nc-raw-${tag}.raw`);
  const tmpCfg = path.join(dir, `nc-cfg-${tag}.txt`);
  const tmpCmds = path.join(dir, `nc-dfs-${tag}.txt`);
  const tmpOut = `${overlayDiskPath}.new.qcow2`;

  try {
    await writeFile(tmpCfg, config, "utf8");

    // 1. Extract MBR (512 bytes) to find partition 2's actual byte offset.
    await execFileAsync("qemu-img", [
      "dd",
      "-f",
      "qcow2",
      "-O",
      "raw",
      `if=${overlayDiskPath}`,
      `of=${tmpMbr}`,
      "bs=512",
      "count=1",
    ]);
    const mbr = await readFile(tmpMbr);
    // MBR partition table: entry 1 at byte 446, entry 2 at byte 462 (each 16 bytes).
    // Bytes 8–11: LBA start (uint32 LE). Bytes 12–15: sector count (uint32 LE).
    const p2LbaStart = mbr.readUInt32LE(462 + 8);
    const p2SectorCount = mbr.readUInt32LE(462 + 12);
    if (p2LbaStart === 0 || p2SectorCount === 0) {
      throw new Error(
        `vEOS flash: could not find partition 2 in MBR (start=${p2LbaStart}, count=${p2SectorCount})`,
      );
    }
    const p2ByteOffset = p2LbaStart * 512;
    const p2Mb = Math.ceil((p2SectorCount * 512) / (1024 * 1024));
    console.log(
      `[veos-flash] partition 2: LBA ${p2LbaStart}, ${p2SectorCount} sectors (~${p2Mb} MB), byte offset ${p2ByteOffset}`,
    );

    // 2. Convert overlay qcow2 → sparse raw.
    //    -S 512: zero-filled regions become sparse holes on APFS/ext4 — only
    //    allocated ext2 blocks consume real disk space (~200–500 MB, not 4 GB+).
    console.log(
      "[veos-flash] converting overlay to sparse raw (this may take a moment)…",
    );
    await execFileAsync("qemu-img", [
      "convert",
      "-f",
      "qcow2",
      "-O",
      "raw",
      "-S",
      "512",
      overlayDiskPath,
      tmpRaw,
    ]);

    // 3. Write startup-config into partition 2 via debugfs.
    //    The `file?offset=N` device string tells e2fsprogs to treat the raw file
    //    as a filesystem starting at byte N — no separate partition extraction needed.
    //    rm first: debugfs `write` won't overwrite an existing file.
    const debugfs = await resolveDebugfs();
    await writeFile(
      tmpCmds,
      `rm /startup-config\nwrite ${tmpCfg} /startup-config\n`,
      "utf8",
    );
    await execFileAsync(debugfs, [
      "-w",
      "-f",
      tmpCmds,
      `${tmpRaw}?offset=${p2ByteOffset}`,
    ]);
    console.log("[veos-flash] startup-config written to flash partition");

    // 4. Convert modified raw → qcow2 and atomically replace the overlay.
    await execFileAsync("qemu-img", [
      "convert",
      "-f",
      "raw",
      "-O",
      "qcow2",
      tmpRaw,
      tmpOut,
    ]);
    await rename(tmpOut, overlayDiskPath);
  } finally {
    for (const f of [tmpMbr, tmpRaw, tmpCfg, tmpCmds, tmpOut]) {
      await rm(f, { force: true });
    }
  }
}

async function resolveDebugfs(): Promise<string> {
  // Homebrew e2fsprogs installs to sbin, not in default PATH on macOS
  // Try brew --prefix first to handle any version in the Cellar
  try {
    const { stdout } = await execFileAsync("brew", ["--prefix", "e2fsprogs"]);
    const brewPath = `${stdout.trim()}/sbin/debugfs`;
    await execFileAsync(brewPath, ["-V"]);
    return brewPath;
  } catch {
    // brew not available or e2fsprogs not installed via brew
  }

  const candidates = [
    "/opt/homebrew/sbin/debugfs",
    "/usr/local/sbin/debugfs",
    "/usr/sbin/debugfs",
    "debugfs",
  ];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["-V"]);
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return candidate;
    }
  }
  throw new Error(
    "debugfs not found. Install e2fsprogs: brew install e2fsprogs  (macOS) or apt install e2fsprogs  (Linux)",
  );
}

// --- Generic ISO builder (Linux-style directory tree -> cdrom) ---
// Reuses the same tooling as the cloud-init injector (hdiutil on macOS,
// genisoimage/mkisofs elsewhere).
async function buildIsoImage(
  tmpDir: string,
  outputPath: string,
  volumeLabel: string | null,
): Promise<Array<string>> {
  if (process.platform === "darwin") {
    const args = ["makehybrid", "-iso", "-joliet", "-o", outputPath, tmpDir];
    if (volumeLabel) {
      args.splice(2, 0, "-default-volume-name", volumeLabel);
    }
    await execFileAsync("hdiutil", args);
  } else {
    const tool = await resolveIsoTool();
    const args = ["-o", outputPath, "-r", "-J"];
    if (volumeLabel) {
      args.push("-V", volumeLabel);
    }
    args.push(tmpDir);
    await execFileAsync(tool, args);
  }
  return ["-drive", `file=${outputPath},media=cdrom,readonly=on`];
}

// --- Cisco IOS-XR (XRv / XRv9k) CVAC ---
// Cisco Virtual Appliance Configuration: an ISO labeled config-1 containing
// iosxr_config.txt, attached as a virtio cdrom. XR applies it at boot when
// no existing configuration is present (Cisco XRv9k install guide, CVAC).
export async function injectIosxrCvac(
  config: string,
  outputPath: string,
): Promise<string[]> {
  const tmpDir = await makeTempDir();
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(path.join(tmpDir, "iosxr_config.txt"), config, "utf8");
    return await buildIsoImage(tmpDir, outputPath, "config-1");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// --- Cisco NX-OS (NX-OSv / Nexus 9000v) CVAC ---
// Same out-of-band mechanism as XRv: an ISO containing nxos_config.txt,
// applied at startup when no configuration exists (Cisco Nexus 9000v guide).
export async function injectNxosCvac(
  config: string,
  outputPath: string,
): Promise<string[]> {
  const tmpDir = await makeTempDir();
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(path.join(tmpDir, "nxos_config.txt"), config, "utf8");
    return await buildIsoImage(tmpDir, outputPath, null);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// --- Juniper vSRX bootstrap ISO ---
// vSRX (KVM) reads juniper.conf from the root of a mounted ISO and applies
// it on boot; the ISO must be removed before the next reboot (Juniper vSRX
// KVM deployment guide). Inject-once boot actions handle that here: the day-0
// drive is only attached for the first power-on.
export async function injectVsrxBootstrapIso(
  config: string,
  outputPath: string,
): Promise<string[]> {
  const tmpDir = await makeTempDir();
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(path.join(tmpDir, "juniper.conf"), config, "utf8");
    return await buildIsoImage(tmpDir, outputPath, null);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// --- FortiGate config drive ---
// FortiGate-VM parses a cloud-init-style config drive: a cdrom ISO with
// openstack/latest/user_data containing raw FortiOS CLI commands
// (FortiGate Private Cloud guide, "Cloud-init using config drive").
export async function injectFortigateConfigDrive(
  config: string,
  outputPath: string,
): Promise<string[]> {
  const tmpDir = await makeTempDir();
  try {
    await mkdir(path.join(tmpDir, "openstack", "latest"), { recursive: true });
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(
      path.join(tmpDir, "openstack", "latest", "user_data"),
      config,
      "utf8",
    );
    return await buildIsoImage(tmpDir, outputPath, null);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// --- VyOS cloud-init (NoCloud seed) ---
// VyOS ships with cloud-init: the config text is the raw #cloud-config
// user-data (the model writes vyos_config_commands set-style commands).
// A cidata ISO with user-data + meta-data, attached as cdrom (VyOS docs,
// NoCloud data source).
export async function injectVyosCloudInit(
  config: string,
  outputPath: string,
): Promise<string[]> {
  const tmpDir = await makeTempDir();
  try {
    await mkdir(path.dirname(outputPath), { recursive: true });
    const userData = config.startsWith("#cloud-config")
      ? config
      : `#cloud-config\nvyos_config_commands:\n${config
          .split("\n")
          .map((line) => `- ${line.trim()}`)
          .join("\n")}\n`;
    await writeFile(path.join(tmpDir, "user-data"), userData, "utf8");
    await writeFile(path.join(tmpDir, "meta-data"), "", "utf8");
    return await buildIsoImage(tmpDir, outputPath, "cidata");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function makeTempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `nc-cfg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function resolveIsoTool(): Promise<string> {
  for (const tool of ["genisoimage", "mkisofs"]) {
    try {
      await execFileAsync("which", [tool]);
      return tool;
    } catch {
      // not found, try next
    }
  }
  throw new Error(
    "No ISO creation tool found. Install genisoimage or mkisofs.",
  );
}
