import os from "node:os";

import { ipCommand } from "./ipCommand.js";
import type { NetworkOperation } from "./types.js";

function currentUser(): string | null {
  if (process.env.SUDO_USER) return process.env.SUDO_USER;
  if (process.env.USER) return process.env.USER;

  try {
    return os.userInfo().username;
  } catch {
    return null;
  }
}

export function buildCommand(op: NetworkOperation): string[] {
  switch (op.kind) {
    case "create-bridge":
      return ipCommand([
        "link",
        "add",
        "name",
        op.bridgeName,
        "type",
        "bridge",
      ]);
    case "delete-bridge":
      return ipCommand(["link", "del", "name", op.bridgeName]);
    case "create-tap": {
      const user = currentUser();
      return user
        ? ipCommand([
            "tuntap",
            "add",
            "dev",
            op.tapName,
            "mode",
            "tap",
            "user",
            user,
          ])
        : ipCommand(["tuntap", "add", "dev", op.tapName, "mode", "tap"]);
    }
    case "delete-tap":
      return ipCommand(["link", "del", "dev", op.tapName]);
    case "attach-to-bridge":
      return ipCommand([
        "link",
        "set",
        "dev",
        op.interfaceName,
        "master",
        op.bridgeName,
      ]);
    case "detach-from-bridge":
      return ipCommand(["link", "set", "dev", op.interfaceName, "nomaster"]);
    case "create-veth-pair":
      return ipCommand([
        "link",
        "add",
        "name",
        op.vethLeft,
        "type",
        "veth",
        "peer",
        "name",
        op.vethRight,
      ]);
    case "delete-veth":
      return ipCommand(["link", "del", "dev", op.vethName]);
    case "set-interface-up":
      return ipCommand(["link", "set", "dev", op.interfaceName, "up"]);
    case "set-interface-down":
      return ipCommand(["link", "set", "dev", op.interfaceName, "down"]);
  }
}
