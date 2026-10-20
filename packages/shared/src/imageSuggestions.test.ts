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

  it("matches container image names too", () => {
    expect(suggestTemplateId("alpine-3.20.qcow2")).toBe(
      "linux-alpine-container",
    );
  });

  it("returns null when nothing matches", () => {
    expect(suggestTemplateId("blank-1G.qcow2")).toBeNull();
    expect(suggestTemplateId("")).toBeNull();
  });
});
