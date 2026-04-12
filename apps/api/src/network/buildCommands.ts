import type { NetworkOperation } from "./types.js";

export function buildCommand(op: NetworkOperation): string[] {
  switch (op.kind) {
    case "create-bridge":
      return ["ip", "link", "add", "name", op.bridgeName, "type", "bridge"];
    case "delete-bridge":
      return ["ip", "link", "del", "name", op.bridgeName];
    case "create-tap":
      return ["ip", "tuntap", "add", "dev", op.tapName, "mode", "tap"];
    case "delete-tap":
      return ["ip", "link", "del", "dev", op.tapName];
    case "attach-to-bridge":
      return [
        "ip",
        "link",
        "set",
        "dev",
        op.interfaceName,
        "master",
        op.bridgeName,
      ];
    case "detach-from-bridge":
      return ["ip", "link", "set", "dev", op.interfaceName, "nomaster"];
    case "create-veth-pair":
      return [
        "ip",
        "link",
        "add",
        "name",
        op.vethLeft,
        "type",
        "veth",
        "peer",
        "name",
        op.vethRight,
      ];
    case "delete-veth":
      return ["ip", "link", "del", "dev", op.vethName];
    case "set-interface-up":
      return ["ip", "link", "set", "dev", op.interfaceName, "up"];
    case "set-interface-down":
      return ["ip", "link", "set", "dev", op.interfaceName, "down"];
  }
}
