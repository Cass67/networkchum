import { describe, expect, it } from "vitest";

import { ImageRecordSchema, TemplateSchema } from "./catalog.js";

describe("TemplateSchema", () => {
  it("accepts a qemu template with resource limits", () => {
    const result = TemplateSchema.parse({
      id: "cisco-asr",
      runtime: "qemu",
      displayName: "Cisco ASR",
      vendor: "Cisco",
      boot: {
        console: "serial",
        machineType: "q35",
        nicModel: "virtio-net-pci",
        acceleration: "kvm",
      },
      configSchema: {
        ramMb: { default: 8192, min: 4096, max: 16384 },
        vcpu: { default: 4, min: 2, max: 8 },
        interfaceCount: { default: 8, min: 4, max: 24 },
      },
      deviceRoleIcon: "router",
    });

    expect(result.runtime).toBe("qemu");
  });

  it("accepts a cloud template with zero compute resources", () => {
    const result = TemplateSchema.parse({
      id: "cloud",
      runtime: "cloud",
      displayName: "Cloud",
      vendor: "NetworkChum",
      boot: {
        console: "none",
        acceleration: "n/a",
      },
      configSchema: {
        ramMb: { default: 0, min: 0, max: 0 },
        vcpu: { default: 0, min: 0, max: 0 },
        interfaceCount: { default: 10, min: 1, max: 24 },
      },
      deviceRoleIcon: "cloud",
    });

    expect(result.runtime).toBe("cloud");
  });

  it("preserves a deviceRoleIcon value", () => {
    const result = TemplateSchema.parse({
      id: "router-template",
      runtime: "qemu",
      displayName: "Router Template",
      vendor: "NetworkChum",
      boot: {
        console: "serial",
        acceleration: "kvm",
      },
      configSchema: {
        ramMb: { default: 4096, min: 2048, max: 8192 },
        vcpu: { default: 2, min: 1, max: 4 },
        interfaceCount: { default: 4, min: 2, max: 8 },
      },
      deviceRoleIcon: "router",
    });

    expect(result.deviceRoleIcon).toBe("router");
  });
});

describe("ImageRecordSchema", () => {
  it("accepts uploaded image records with catalog state", () => {
    const result = ImageRecordSchema.parse({
      id: "img-1",
      name: "csr1000v.qcow2",
      path: "/data/images/uploads/csr1000v.qcow2",
      format: "qcow2",
      sizeBytes: 1024,
      updatedAt: new Date().toISOString(),
      templateId: null,
      suggestedTemplateId: "cisco-asr",
      source: "upload",
      catalogState: "active",
    });

    expect(result.source).toBe("upload");
  });
});
