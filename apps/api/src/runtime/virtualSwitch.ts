// Virtual switch: runs inside the API process, connects to every QEMU NIC's
// listen socket and forwards Ethernet frames between interfaces that share a
// network. Updating the cable topology (attach/detach) is instant — no VM
// restart needed.
//
// QEMU socket-netdev frame format over TCP:
//   4-byte big-endian length | <length> bytes of raw Ethernet frame

import net from "node:net";

const RECONNECT_MS = 2000;
const HEADER = 4;

type NicEntry = {
  interfaceId: string;
  port: number;
  socket: net.Socket | null;
  buf: Buffer;
};

export type VirtualSwitchAdapter = {
  reset: () => void;
  addNic: (interfaceId: string, port: number) => void;
  removeNic: (interfaceId: string) => void;
  syncAttachments: (
    attachments: Array<{ interfaceId: string; networkId: string }>,
  ) => void;
};

class VirtualSwitch implements VirtualSwitchAdapter {
  private nics = new Map<string, NicEntry>(); // interfaceId → entry
  private routing = new Map<string, string>(); // interfaceId → networkId
  private segments = new Map<string, Set<string>>(); // networkId  → Set<interfaceId>

  reset(): void {
    for (const entry of this.nics.values()) {
      entry.socket?.destroy();
      entry.socket = null;
    }

    this.nics.clear();
    this.routing.clear();
    this.segments.clear();
  }

  /** Register a NIC when its VM powers on. */
  addNic(interfaceId: string, port: number): void {
    if (this.nics.has(interfaceId)) return;
    const entry: NicEntry = {
      interfaceId,
      port,
      socket: null,
      buf: Buffer.alloc(0),
    };
    this.nics.set(interfaceId, entry);
    this.connectNic(entry);
  }

  /** Deregister a NIC when its VM powers off. */
  removeNic(interfaceId: string): void {
    const entry = this.nics.get(interfaceId);
    if (!entry) return;
    entry.socket?.destroy();
    entry.socket = null;
    this.nics.delete(interfaceId);
    this.unroute(interfaceId);
  }

  /** Sync all routing from the current lab attachment list. Call after any cable change. */
  syncAttachments(
    attachments: Array<{ interfaceId: string; networkId: string }>,
  ): void {
    for (const id of [...this.routing.keys()]) this.unroute(id);
    for (const a of attachments) this.addRoute(a.interfaceId, a.networkId);
  }

  private addRoute(interfaceId: string, networkId: string): void {
    this.unroute(interfaceId);
    this.routing.set(interfaceId, networkId);
    let seg = this.segments.get(networkId);
    if (!seg) {
      seg = new Set();
      this.segments.set(networkId, seg);
    }
    seg.add(interfaceId);
  }

  private unroute(interfaceId: string): void {
    const networkId = this.routing.get(interfaceId);
    if (!networkId) return;
    const seg = this.segments.get(networkId);
    seg?.delete(interfaceId);
    if (seg?.size === 0) this.segments.delete(networkId);
    this.routing.delete(interfaceId);
  }

  private connectNic(entry: NicEntry): void {
    const socket = net.createConnection({
      port: entry.port,
      host: "127.0.0.1",
    });

    socket.on("connect", () => {
      entry.socket = socket;
      entry.buf = Buffer.alloc(0);
    });

    socket.on("data", (data: Buffer) => {
      entry.buf = Buffer.concat([entry.buf, data]);
      this.drain(entry);
    });

    socket.on("error", () => {
      /* handled by close */
    });

    socket.on("close", () => {
      entry.socket = null;
      if (this.nics.has(entry.interfaceId)) {
        setTimeout(() => this.connectNic(entry), RECONNECT_MS);
      }
    });
  }

  private drain(entry: NicEntry): void {
    while (entry.buf.length >= HEADER) {
      const len = entry.buf.readUInt32BE(0);
      if (entry.buf.length < HEADER + len) break;
      const frame = entry.buf.subarray(HEADER, HEADER + len);
      entry.buf = entry.buf.subarray(HEADER + len);
      this.forward(entry.interfaceId, frame);
    }
  }

  private forward(fromId: string, frame: Buffer): void {
    const networkId = this.routing.get(fromId);
    if (!networkId) return;
    const peers = this.segments.get(networkId);
    if (!peers) return;
    const pkt = Buffer.allocUnsafe(HEADER + frame.length);
    pkt.writeUInt32BE(frame.length, 0);
    frame.copy(pkt, HEADER);
    for (const peer of peers) {
      if (peer !== fromId) this.nics.get(peer)?.socket?.write(pkt);
    }
  }
}

export const virtualSwitch = new VirtualSwitch();
