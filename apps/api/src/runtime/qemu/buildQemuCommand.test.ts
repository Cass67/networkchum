import { describe, expect, it } from "vitest";

import { buildQemuCommand } from "./buildQemuCommand.js";

describe("buildQemuCommand", () => {
  it("builds a qemu command with acceleration and tap interfaces", () => {
    const result = buildQemuCommand({
      labId: "lab-1",
      nodeId: "node-1",
      imagePath: "/images/asr.qcow2",
      config: {
        ramMb: 8192,
        vcpu: 4,
        interfaceCount: 2,
        nicModel: "virtio-net-pci",
        accelerationMode: "kvm",
      },
      machineType: "q35",
    });

    const commandLine = result.join(" ");

    expect(result).toContain("qemu-system-x86_64");
    expect(result).toContain("-accel");
    expect(result).toContain("kvm");
    expect(commandLine).toContain("tap-lab1-ode1-0");
    expect(commandLine).toContain("tap-lab1-ode1-1");
  });

  it("uses socket listen ports for each NIC when nicPorts provided", () => {
    const result = buildQemuCommand({
      labId: "lab-1",
      nodeId: "node-1",
      imagePath: "/images/vm.qcow2",
      config: {
        ramMb: 2048,
        vcpu: 2,
        interfaceCount: 2,
        nicModel: "e1000",
        accelerationMode: "hvf",
      },
      machineType: "q35",
      networkBackend: "socket",
      nicPorts: [20000, 20001],
    });

    const commandLine = result.join(" ");

    expect(commandLine).toContain("hvf");
    expect(commandLine).toContain("listen=127.0.0.1:20000");
    expect(commandLine).toContain("listen=127.0.0.1:20001");
    expect(commandLine).not.toContain("connect=");
    expect(commandLine).not.toContain("tap");
  });

  it("falls back to user-mode when socket backend has no nicPorts", () => {
    const result = buildQemuCommand({
      labId: "lab-1",
      nodeId: "node-1",
      imagePath: "/images/vm.qcow2",
      config: { ramMb: 1024, vcpu: 1, interfaceCount: 1 },
      machineType: "q35",
      networkBackend: "socket",
    });

    expect(result.join(" ")).toContain("user,id=net0,restrict=on");
  });

  it("adds a modern x86 CPU model when running under tcg", () => {
    const result = buildQemuCommand({
      labId: "lab-1",
      nodeId: "node-1",
      imagePath: "/images/vm.qcow2",
      config: {
        ramMb: 1024,
        vcpu: 1,
        interfaceCount: 1,
        accelerationMode: "tcg",
      },
      machineType: "q35",
    });

    expect(result.join(" ")).toContain("-cpu max");
  });

  it("does not add acceleration flag when mode is none", () => {
    const result = buildQemuCommand({
      labId: "lab-1",
      nodeId: "node-1",
      imagePath: "/images/vm.qcow2",
      config: {
        ramMb: 2048,
        vcpu: 2,
        interfaceCount: 1,
        accelerationMode: "none",
      },
      machineType: "q35",
    });

    expect(result).not.toContain("-accel");
  });
});
