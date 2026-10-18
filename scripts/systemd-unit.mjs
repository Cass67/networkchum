#!/usr/bin/env node
// Prints the systemd unit for NetworkChum's production service to stdout.
// Kept as a separate script so `./start.sh install-service` can pipe it into
// `sudo tee` and so the unit content is unit-testable.
//
// Inputs (env):
//   NETWORKCHUM_UNIT_USER  user to run the service as (required)
//   NETWORKCHUM_ROOT       repo root / WorkingDirectory (required)
//   NETWORKCHUM_BIND_MODE  localhost | lan (default: localhost)
//   NETWORKCHUM_DATA_DIR   data dir to persist (optional)
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
const tapMode = process.env.NETWORKCHUM_TAP_MODE ?? "ambient";

const service = [
  "[Unit]",
  "Description=NetworkChum network lab workbench",
  "After=network-online.target",
  "Wants=network-online.target",
  "",
  "[Service]",
  "Type=simple",
  `User=${user}`,
  `WorkingDirectory=${root}`,
  // /usr/sbin + /sbin are required for `ip` and `getcap` on RHEL-family hosts.
  "Environment=PATH=/usr/local/bin:/usr/bin:/usr/sbin:/sbin:/bin",
  `Environment=NETWORKCHUM_BIND_MODE=${mode}`,
];

if (dataDir) {
  service.push(`Environment=NETWORKCHUM_DATA_DIR=${dataDir}`);
}

// Two supported ways to get CAP_NET_ADMIN for TAP/bridge setup:
//  - ambient: the service process itself holds the capability (needs rootless
//    podman to tolerate ambient caps on this host)
//  - ip-capability: `ip` carries the capability as a file capability, so the
//    service process stays completely unprivileged (always safe for podman)
// install-service probes this and picks one automatically.
if (tapMode === "ambient") {
  service.push("AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW");
}

service.push(
  `ExecStart=${root}/start.sh serve`,
  "Restart=on-failure",
  "RestartSec=3",
  "",
  "[Install]",
  "WantedBy=multi-user.target",
);

process.stdout.write(`${service.join("\n")}\n`);
