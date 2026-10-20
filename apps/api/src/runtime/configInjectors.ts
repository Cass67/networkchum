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
