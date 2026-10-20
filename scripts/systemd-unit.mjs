#!/usr/bin/env node
// Prints the systemd unit for NetworkChum's production service to stdout.
// Kept as a separate script so `./start.sh install-service` can pipe it into the
// right location and so the unit content is unit-testable.
//
// Inputs (env):
//   NETWORKCHUM_UNIT_USER       user to run the service as (required)
//   NETWORKCHUM_ROOT            repo root / WorkingDirectory (required)
//   NETWORKCHUM_BIND_MODE       localhost | lan (default: localhost)
//   NETWORKCHUM_DATA_DIR        data dir to persist (optional)
//   NETWORKCHUM_SERVICE_SCOPE   system | user (default: system)
//   NETWORKCHUM_TAP_MODE        ambient | ip-capability (default: ambient)
const user = process.env.NETWORKCHUM_UNIT_USER;
const root = process.env.NETWORKCHUM_ROOT;

if (!user || !root) {
  console.error(
    "error: NETWORKCHUM_UNIT_USER and NETWORKCHUM_ROOT are required",
  );
  process.exit(1);
}

const mode = process.env.NETWORKCHUM_BIND_MODE ?? "localhost";
const dataDir = process.env.NETWORKCHUM_DATA_DIR ?? "";
const scope = process.env.NETWORKCHUM_SERVICE_SCOPE ?? "system";
const tapMode = process.env.NETWORKCHUM_TAP_MODE ?? "ambient";

const service = ["[Unit]", "Description=NetworkChum network lab workbench"];

// System units may wait for the network; user units cannot reference system
// targets, so they start with the user's default target.
if (scope === "system") {
  service.push("After=network-online.target", "Wants=network-online.target");
}

service.push("", "[Service]", "Type=simple");

// User units already run as their owner, and User= is not valid there.
if (scope === "system") {
  service.push(`User=${user}`);
}

service.push(
  `WorkingDirectory=${root}`,
  // /usr/sbin + /sbin are required for `ip` and `getcap` on RHEL-family hosts.
  "Environment=PATH=/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/bin",
  `Environment=NETWORKCHUM_BIND_MODE=${mode}`,
);

if (dataDir) {
  service.push(`Environment=NETWORKCHUM_DATA_DIR=${dataDir}`);
}

// Write logs to a file the operator can always read. The systemd user journal
// is not readable by default on RHEL-family hosts (no systemd-journal group
// membership), which makes failures invisible.
service.push(
  `StandardOutput=append:${root}/.networkchum/service.log`,
  `StandardError=append:${root}/.networkchum/service.log`,
);

// Ways to get CAP_NET_ADMIN for TAP/bridge setup:
//  - ambient: the system unit process holds the capability directly.
//  - ip-capability: `ip` carries a file capability (works where SELinux
//    honours file capabilities).
//  - ip-sudo: the service runs `ip` through sudo via a NOPASSWD rule, needed
//    on SELinux hosts that do not apply file capabilities to the user domain.
if (scope === "system" && tapMode === "ambient") {
  service.push("AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW");
}

if (tapMode === "ip-sudo") {
  service.push("Environment=NETWORKCHUM_IP_SUDO=1");
  const ipPath = process.env.NETWORKCHUM_UNIT_IP_PATH ?? "";
  if (ipPath) {
    service.push(`Environment=NETWORKCHUM_IP_PATH=${ipPath}`);
  }
}

if (tapMode === "socket") {
  service.push("Environment=NETWORKCHUM_NETWORK_BACKEND=socket");
}

const managementUplink = process.env.NETWORKCHUM_UNIT_MANAGEMENT_UPLINK ?? "";
if (managementUplink) {
  service.push(`Environment=NETWORKCHUM_MANAGEMENT_UPLINK=${managementUplink}`);
}

service.push(
  `ExecStart=${root}/start.sh serve`,
  "Restart=on-failure",
  "RestartSec=3",
  // VM processes are children of the API server; without this, every service
  // restart (deploy) tears down the cgroup and kills running qemu VMs. The
  // runtime-state store tracks those VMs and consoles/links re-attach on
  // demand, so leaving them running across restarts is safe.
  "KillMode=none",
  "",
  "[Install]",
  scope === "user" ? "WantedBy=default.target" : "WantedBy=multi-user.target",
);

process.stdout.write(`${service.join("\n")}\n`);
