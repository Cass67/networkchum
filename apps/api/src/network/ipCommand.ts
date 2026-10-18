// Builds an `ip` command, optionally routed through sudo.
//
// On some Linux hosts the API process cannot hold CAP_NET_ADMIN itself — for
// example a systemd *user* service under SELinux, where file capabilities set on
// `ip` are not applied to the unconfined user domain. In that case the installer
// grants a narrowly scoped NOPASSWD rule for `ip` and sets
// NETWORKCHUM_IP_SUDO=1, so privileged network setup runs via sudo instead.
export function ipCommand(args: string[]): string[] {
  const ipPath = process.env.NETWORKCHUM_IP_PATH?.trim() || "ip";
  if (process.env.NETWORKCHUM_IP_SUDO === "1") {
    return ["sudo", "-n", ipPath, ...args];
  }
  return [ipPath, ...args];
}
