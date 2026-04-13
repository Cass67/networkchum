type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

type RunCommand = (command: string, args: string[]) => Promise<CommandResult>;

type LinkInfo = {
  ifname: string;
  address?: string;
  master?: string;
};

type AddressInfo = {
  family?: string;
  local?: string;
  prefixlen?: number;
  scope?: string;
};

type RouteInfo = {
  dst?: string;
  gateway?: string;
  dev?: string;
  metric?: number;
  prefsrc?: string;
};

type PlanInput = {
  bridgeName: string;
  uplinkName: string;
  bridgeLink: LinkInfo;
  bridgeAddresses: AddressInfo[];
  uplinkLink: LinkInfo;
  uplinkAddresses: AddressInfo[];
  defaultRoutes: RouteInfo[];
};

function isLanBindMode() {
  return process.env.NETWORKCHUM_BIND_MODE === "lan";
}

function managementUplinkPreference() {
  return process.env.NETWORKCHUM_MANAGEMENT_UPLINK?.trim() || "auto";
}

function ipv4Cidrs(addresses: AddressInfo[]): string[] {
  return addresses
    .filter(
      (
        address,
      ): address is Required<Pick<AddressInfo, "local" | "prefixlen">> &
        AddressInfo =>
        address.family === "inet" &&
        address.scope === "global" &&
        typeof address.local === "string" &&
        typeof address.prefixlen === "number",
    )
    .map((address) => `${address.local}/${address.prefixlen}`);
}

function defaultRoutesForInterface(
  routes: RouteInfo[],
  interfaceName: string,
): RouteInfo[] {
  return routes.filter(
    (route) =>
      (route.dst === "default" || route.dst === undefined) &&
      route.dev === interfaceName,
  );
}

function routeReplaceCommand(route: RouteInfo, bridgeName: string): string[] {
  const command = ["ip", "route", "replace", "default"];
  if (route.gateway) {
    command.push("via", route.gateway);
  }
  command.push("dev", bridgeName);
  if (route.metric !== undefined) {
    command.push("metric", String(route.metric));
  }
  if (route.prefsrc) {
    command.push("src", route.prefsrc);
  }
  return command;
}

export function planManagementBridgeUplinkCommands(
  input: PlanInput,
): string[][] {
  const bridgeCidrs = new Set(ipv4Cidrs(input.bridgeAddresses));
  const uplinkCidrs = ipv4Cidrs(input.uplinkAddresses);
  const uplinkRoutes = defaultRoutesForInterface(
    input.defaultRoutes,
    input.uplinkName,
  );
  const bridgeRoutes = defaultRoutesForInterface(
    input.defaultRoutes,
    input.bridgeName,
  );

  if (
    input.uplinkLink.master === input.bridgeName &&
    uplinkCidrs.length === 0 &&
    uplinkRoutes.length === 0 &&
    bridgeRoutes.length > 0
  ) {
    return [];
  }

  const commands: string[][] = [];

  if (
    input.uplinkLink.address &&
    input.bridgeLink.address !== input.uplinkLink.address
  ) {
    commands.push([
      "ip",
      "link",
      "set",
      "dev",
      input.bridgeName,
      "address",
      input.uplinkLink.address,
    ]);
  }

  commands.push(["ip", "link", "set", "dev", input.bridgeName, "up"]);

  for (const cidr of uplinkCidrs) {
    if (!bridgeCidrs.has(cidr)) {
      commands.push(["ip", "addr", "add", cidr, "dev", input.bridgeName]);
    }
  }

  if (input.uplinkLink.master !== input.bridgeName) {
    commands.push([
      "ip",
      "link",
      "set",
      "dev",
      input.uplinkName,
      "master",
      input.bridgeName,
    ]);
  }

  commands.push(["ip", "link", "set", "dev", input.uplinkName, "up"]);

  for (const cidr of uplinkCidrs) {
    commands.push(["ip", "addr", "del", cidr, "dev", input.uplinkName]);
  }

  for (const route of uplinkRoutes) {
    commands.push(routeReplaceCommand(route, input.bridgeName));
  }

  return commands;
}

function parseJsonArray<T>(stdout: string): T[] | null {
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

async function queryLinkInfo(
  runCommand: RunCommand,
  interfaceName: string,
): Promise<LinkInfo | null> {
  const result = await runCommand("ip", [
    "-json",
    "link",
    "show",
    "dev",
    interfaceName,
  ]);
  if (!result.ok) {
    return null;
  }

  return parseJsonArray<LinkInfo>(result.stdout)?.[0] ?? null;
}

async function queryAddressInfo(
  runCommand: RunCommand,
  interfaceName: string,
): Promise<AddressInfo[] | null> {
  const result = await runCommand("ip", [
    "-json",
    "addr",
    "show",
    "dev",
    interfaceName,
  ]);
  if (!result.ok) {
    return null;
  }

  const parsed = parseJsonArray<{ addr_info?: AddressInfo[] }>(
    result.stdout,
  )?.[0];
  return parsed?.addr_info ?? [];
}

async function queryDefaultRoutes(
  runCommand: RunCommand,
): Promise<RouteInfo[] | null> {
  const result = await runCommand("ip", ["-json", "route", "show", "default"]);
  if (!result.ok) {
    return null;
  }

  return parseJsonArray<RouteInfo>(result.stdout);
}

async function resolveUplinkName(
  runCommand: RunCommand,
  bridgeName: string,
): Promise<string | null> {
  const preference = managementUplinkPreference();
  if (preference === "none") {
    return null;
  }
  if (preference !== "auto") {
    return preference;
  }

  const routes = await queryDefaultRoutes(runCommand);
  const route = routes?.find(
    (candidate) =>
      (candidate.dst === "default" || candidate.dst === undefined) &&
      candidate.dev &&
      candidate.dev !== bridgeName,
  );
  return route?.dev ?? null;
}

export async function ensureManagementBridgeUplink(
  runCommand: RunCommand,
  bridgeTargets: ReadonlyMap<string, string>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isLanBindMode()) {
    return { ok: true };
  }

  if (![...bridgeTargets.values()].includes("nc-mgmt")) {
    return { ok: true };
  }

  const bridgeName = "nc-mgmt";
  const uplinkName = await resolveUplinkName(runCommand, bridgeName);
  if (!uplinkName) {
    return {
      ok: false,
      message:
        "Management bridge 'nc-mgmt' could not find a usable host uplink. Set NETWORKCHUM_MANAGEMENT_UPLINK=<interface> or NETWORKCHUM_MANAGEMENT_UPLINK=none to disable automatic LAN bridging.",
    };
  }

  const [
    bridgeLink,
    bridgeAddresses,
    uplinkLink,
    uplinkAddresses,
    defaultRoutes,
  ] = await Promise.all([
    queryLinkInfo(runCommand, bridgeName),
    queryAddressInfo(runCommand, bridgeName),
    queryLinkInfo(runCommand, uplinkName),
    queryAddressInfo(runCommand, uplinkName),
    queryDefaultRoutes(runCommand),
  ]);

  if (
    !bridgeLink ||
    !bridgeAddresses ||
    !uplinkLink ||
    !uplinkAddresses ||
    !defaultRoutes
  ) {
    return {
      ok: false,
      message: `Management bridge '${bridgeName}' could not inspect the current uplink state for '${uplinkName}'.`,
    };
  }

  const commands = planManagementBridgeUplinkCommands({
    bridgeName,
    uplinkName,
    bridgeLink,
    bridgeAddresses,
    uplinkLink,
    uplinkAddresses,
    defaultRoutes,
  });

  for (const command of commands) {
    const result = await runCommand(command[0]!, command.slice(1));
    if (!result.ok) {
      return {
        ok: false,
        message: `Management bridge uplink setup failed: ${command.join(" ")}: ${result.stderr.trim() || "command failed"}`,
      };
    }
  }

  return { ok: true };
}
