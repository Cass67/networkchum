export type NetworkOperation =
  | { kind: "create-bridge"; bridgeName: string }
  | { kind: "delete-bridge"; bridgeName: string }
  | { kind: "create-tap"; tapName: string }
  | { kind: "delete-tap"; tapName: string }
  | { kind: "attach-to-bridge"; interfaceName: string; bridgeName: string }
  | { kind: "detach-from-bridge"; interfaceName: string; bridgeName: string }
  | { kind: "create-veth-pair"; vethLeft: string; vethRight: string }
  | { kind: "delete-veth"; vethName: string }
  | { kind: "set-interface-up"; interfaceName: string }
  | { kind: "set-interface-down"; interfaceName: string };
