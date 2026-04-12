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
    });

    expect(result.runtime).toBe("qemu");
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
