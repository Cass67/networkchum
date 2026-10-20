import net from "node:net";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";

import { virtualSwitch } from "./virtualSwitch.js";

// Fake QEMU NIC: listens like `-netdev socket ...,listen=...`. Frames written
// via sendFromVm are what the VM emits; frames received are what the switch
// delivers (the 4-byte length header the switch prepends is stripped).
type FakeNic = {
  server: net.Server;
  port: Promise<number>;
  frames: Buffer[];
  sendFromVm: (frame: Buffer) => void;
};

function fakeNic(): FakeNic {
  const frames: Buffer[] = [];
  let vmSocket: net.Socket | null = null;
  const server = net.createServer((socket) => {
    vmSocket = socket;
    socket.on("data", (data: Buffer) => {
      frames.push(data.subarray(4));
    });
  });
  return {
    server,
    port: new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as net.AddressInfo;
        resolve(address.port);
      });
    }),
    frames,
    sendFromVm(frame: Buffer) {
      const pkt = Buffer.allocUnsafe(4 + frame.length);
      pkt.writeUInt32BE(frame.length, 0);
      frame.copy(pkt, 4);
      vmSocket?.write(pkt);
    },
  };
}

function waitFor(check: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    let waited = 0;
    const timer = setInterval(() => {
      waited += 50;
      if (check() || waited > 3000) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

const FRAME_A = Buffer.from("frame-from-lab-a");
const FRAME_B = Buffer.from("frame-from-lab-b");

describe("virtual switch lab interconnect", () => {
  const nics: FakeNic[] = [];
  const closers: (() => void)[] = [];

  afterEach(() => {
    for (const fn of closers.splice(0)) fn();
    virtualSwitch.reset();
  });

  it("forwards frames between labs when a fabric group merges their networks", async () => {
    const [nicA, nicB, nicC] = [fakeNic(), fakeNic(), fakeNic()];
    nics.push(nicA, nicB, nicC);
    closers.push(...nics.map((nic) => () => nic.server.close()), () =>
      virtualSwitch.reset(),
    );

    const [portA, portB, portC] = await Promise.all([
      nicA.port,
      nicB.port,
      nicC.port,
    ]);

    // Lab A VM NIC on netA, lab B VM NIC on netB, lab C VM NIC on netC
    // (never bridged, must stay isolated).
    virtualSwitch.addNic("ifA", portA);
    virtualSwitch.addNic("ifB", portB);
    virtualSwitch.addNic("ifC", portC);
    virtualSwitch.syncAttachments([
      { interfaceId: "ifA", networkId: "netA" },
      { interfaceId: "ifB", networkId: "netB" },
      { interfaceId: "ifC", networkId: "netC" },
    ]);
    virtualSwitch.setFabricGroups([["netA", "netB"]]);

    // Let the switch's outbound connections settle.
    await waitFor(() => nicA.frames.length > 0 || true);
    await new Promise((resolve) => setTimeout(resolve, 200));

    nicA.sendFromVm(FRAME_A);
    await waitFor(() => nicB.frames.length > 0);
    assert.equal(nicB.frames.length, 1);
    assert.equal(nicB.frames[0]!.toString(), FRAME_A.toString());
    assert.equal(nicC.frames.length, 0, "lab C must stay isolated");

    nicB.sendFromVm(FRAME_B);
    await waitFor(() => nicA.frames.length > 0);
    assert.equal(nicA.frames.length, 1);
    assert.equal(nicA.frames[0]!.toString(), FRAME_B.toString());
  });

  it("keeps labs isolated without a fabric group", async () => {
    const [nicA, nicB] = [fakeNic(), fakeNic()];
    nics.push(nicA, nicB);
    closers.push(...nics.map((nic) => () => nic.server.close()));

    const [portA, portB] = await Promise.all([nicA.port, nicB.port]);

    virtualSwitch.addNic("ifA", portA);
    virtualSwitch.addNic("ifB", portB);
    virtualSwitch.syncAttachments([
      { interfaceId: "ifA", networkId: "netA" },
      { interfaceId: "ifB", networkId: "netB" },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 200));

    nicA.sendFromVm(FRAME_A);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(nicB.frames.length, 0, "no bridge: no cross-lab frames");
  });
});
