import { describe, expect, it } from "vitest";

import { suggestTemplateId } from "./imageSuggestions.js";

describe("suggestTemplateId", () => {
  it("matches vendor tokens in file names", () => {
    expect(suggestTemplateId("asr-1.qcow2")).toBe("cisco-asr");
    expect(suggestTemplateId("vios-l2.qcow2")).toBe("cisco-vios-switch");
    expect(suggestTemplateId("vios.qcow2")).toBe("cisco-vios");
    expect(suggestTemplateId("vmx-100.qcow2")).toBe("juniper-vmx");
    expect(suggestTemplateId("veos-usb.qcow2")).toBe("arista-veos");
  });

  it("maps Juniper Evolved / vJunos images to VRR", () => {
    expect(suggestTemplateId("vJunosEvolved-23.1R1.8.qcow2")).toBe(
      "juniper-vrr",
    );
    expect(suggestTemplateId("vjuniper-23.2R1.qcow2")).toBe("juniper-vrr");
    expect(suggestTemplateId("vrr-4.qcow2")).toBe("juniper-vrr");
  });

  it("uses the hint name when the file name itself is generic", () => {
    expect(suggestTemplateId("hda.qcow2", "csr1000v")).toBe("cisco-asr");
    expect(suggestTemplateId("hda.qcow2", "some-entry")).toBe("generic-vm");
  });

  it("falls back to the generic VM baseline for unknown images", () => {
    expect(suggestTemplateId("mystery-appliance.qcow2")).toBe("generic-vm");
    expect(suggestTemplateId("some-unknown-os-1.2.3.qcow2")).toBe("generic-vm");
    expect(suggestTemplateId("")).toBe("generic-vm");
  });

  it("matches container image names too", () => {
    expect(suggestTemplateId("alpine-3.20.qcow2")).toBe(
      "linux-alpine-container",
    );
  });

  it("returns null only for the reserved blank fallback disk", () => {
    expect(suggestTemplateId("blank-1G.qcow2")).toBeNull();
  });
});
