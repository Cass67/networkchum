import { describe, expect, it } from "vitest";

import {
  junosEvoProfileArgs,
  junosEvoRequiresUefi,
  resolveJunosEvoUefiFirmware,
} from "./configInjectors.js";

describe("junosEvoRequiresUefi", () => {
  it("gates UEFI on the image version (24.2R+ per Juniper's KVM guide)", () => {
    expect(junosEvoRequiresUefi("vJunosEvolved-23.1R1.8.qcow2")).toBe(false);
    expect(junosEvoRequiresUefi("vJunosEvolved-24.1R1.qcow2")).toBe(false);
    expect(junosEvoRequiresUefi("vJunosEvolved-24.2R1.qcow2")).toBe(true);
    expect(junosEvoRequiresUefi("vJunosEvolved-24.4R2.21.qcow2")).toBe(true);
    expect(junosEvoRequiresUefi("vJunosEvolved-25.1R1.qcow2")).toBe(true);
  });

  it("keeps the default BIOS when the version cannot be parsed", () => {
    expect(junosEvoRequiresUefi("vrr-4.qcow2")).toBe(false);
    expect(junosEvoRequiresUefi("mystery.qcow2")).toBe(false);
  });
});

describe("resolveJunosEvoUefiFirmware", () => {
  it("prefers a monolithic firmware usable with -bios", async () => {
    const firmware = await resolveJunosEvoUefiFirmware(
      async (path: string) => path === "/usr/share/qemu/edk2-x86_64-code.fd",
    );
    expect(firmware).toEqual({
      kind: "bios",
      path: "/usr/share/qemu/edk2-x86_64-code.fd",
    });
  });

  it("falls back to a paired OVMF_CODE + VARS (pflash) layout", async () => {
    const firmware = await resolveJunosEvoUefiFirmware(
      async (path: string) =>
        path === "/usr/share/edk2/ovmf/OVMF_CODE.fd" ||
        path === "/usr/share/edk2/ovmf/OVMF_VARS.fd",
    );
    expect(firmware).toEqual({
      kind: "pflash",
      codePath: "/usr/share/edk2/ovmf/OVMF_CODE.fd",
      varsPath: "/usr/share/edk2/ovmf/OVMF_VARS.fd",
    });
  });

  it("returns null when nothing is installed", async () => {
    expect(await resolveJunosEvoUefiFirmware(async () => false)).toBeNull();
  });
});

describe("junosEvoProfileArgs", () => {
  it("injects the Bochs chassis identity (BT chipset) and USB bus on every boot", () => {
    const args = junosEvoProfileArgs("vJunosEvolved-23.1R1.8.qcow2", null);
    expect(args).not.toBeNull();
    expect(args).toContain("-smbios");
    expect(args).toContain(
      "type=1,manufacturer=Bochs,product=Bochs,serial=chassis_no=0:slot=0:type=1:assembly_id=0x0D20:platform=251:master=0:channelized=no",
    );
    expect(args).toContain("-device");
    expect(args).toContain("qemu-xhci,id=usb");
    expect(args?.join(" ")).not.toContain("-bios");
  });

  it("switches to the BX chipset identity for BX images", () => {
    const args = junosEvoProfileArgs("vJunosEvolvedBX-24.4R2.qcow2", {
      kind: "bios",
      path: "/usr/share/qemu/edk2-x86_64-code.fd",
    });
    expect(args).toContain(
      "type=1,manufacturer=Bochs,product=Bochs,serial=chassis_no=0:slot=0:type=1:assembly_id=0x0DA9:platform=272:master=0:channelized=no",
    );
  });

  it("boots 24.2R+ images with UEFI and refuses when none is installed", () => {
    const withUefi = junosEvoProfileArgs("vJunosEvolved-24.4R2.21.qcow2", {
      kind: "bios",
      path: "/usr/share/qemu/edk2-x86_64-code.fd",
    });
    expect(withUefi).toContain("-bios");
    expect(withUefi).toContain("/usr/share/qemu/edk2-x86_64-code.fd");

    const paired = junosEvoProfileArgs("vJunosEvolved-24.4R2.21.qcow2", {
      kind: "pflash",
      codePath: "/usr/share/edk2/ovmf/OVMF_CODE.fd",
      varsPath: "/data/nodes/vars",
    });
    expect(paired?.join(" ")).toContain(
      "if=pflash,format=raw,file=/usr/share/edk2/ovmf/OVMF_CODE.fd,readonly=on",
    );
    expect(paired?.join(" ")).toContain(
      "if=pflash,format=raw,file=/data/nodes/vars,readonly=off",
    );

    expect(
      junosEvoProfileArgs("vJunosEvolved-24.4R2.21.qcow2", null),
    ).toBeNull();
  });
});
