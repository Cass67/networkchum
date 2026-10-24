import http from "node:http";
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BRIDGE_HOST = "127.0.0.1";
export const BRIDGE_PORT = 4010;

function defaultHasBinary(name) {
  const searchPath = process.env.PATH?.split(":") ?? [];
  return searchPath.some((entry) => existsSync(`${entry}/${name}`));
}

function isSafeExecToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9._/:=@%+,-]+$/.test(value);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload");
  }
  if (
    payload.terminal !== "iterm" &&
    payload.terminal !== "terminal-app" &&
    payload.terminal !== "custom"
  ) {
    throw new Error("Unsupported terminal");
  }
  if (
    payload.relayHost !== undefined &&
    (typeof payload.relayHost !== "string" ||
      !/^[A-Za-z0-9._-]+$/.test(payload.relayHost))
  ) {
    throw new Error("Invalid relay host");
  }
  if (
    payload.relayUser !== undefined &&
    (typeof payload.relayUser !== "string" ||
      !/^[A-Za-z0-9._-]+$/.test(payload.relayUser))
  ) {
    throw new Error("Invalid relay user");
  }

  const hasTelnetTarget =
    typeof payload.host === "string" && payload.port !== undefined;
  const hasExecCommand = Array.isArray(payload.execCommand);

  if (hasTelnetTarget === hasExecCommand) {
    throw new Error("Invalid console target");
  }

  if (hasTelnetTarget) {
    if (payload.host !== "127.0.0.1" && payload.host !== "localhost") {
      throw new Error("Unsupported host");
    }
    if (
      !Number.isInteger(payload.port) ||
      payload.port < 1 ||
      payload.port > 65535
    ) {
      throw new Error("Invalid port");
    }
  }

  if (hasExecCommand) {
    if (
      payload.execCommand.length < 2 ||
      !["docker", "podman"].includes(payload.execCommand[0]) ||
      !payload.execCommand.every(isSafeExecToken)
    ) {
      throw new Error("Invalid exec command");
    }
  }

  return payload;
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function shellWord(value) {
  return isSafeExecToken(value) ? value : shellSingleQuote(value);
}

function buildExecShellCommand(tokens) {
  return tokens.map(shellWord).join(" ");
}

export function buildNativeCommand(payload, options = {}) {
  const { host, port, terminal, template, relayHost, relayUser, execCommand } =
    validatePayload(payload);
  const hasBinary = options.hasBinary ?? defaultHasBinary;
  let command = "";

  if (terminal === "custom") {
    if (execCommand) {
      if (typeof template !== "string" || !template.includes("{command}")) {
        throw new Error("Invalid custom terminal template");
      }

      command = template.replaceAll(
        "{command}",
        buildExecShellCommand(execCommand),
      );
    } else {
      if (
        typeof template !== "string" ||
        !template.includes("{host}") ||
        !template.includes("{port}")
      ) {
        throw new Error("Invalid custom terminal template");
      }

      command = template
        .replaceAll("{host}", host)
        .replaceAll("{port}", String(port));
    }
  } else if (execCommand) {
    command = buildExecShellCommand(execCommand);
  } else if (hasBinary("socat")) {
    command = `socat STDIO,rawer,echo=0 TCP:${host}:${port}`;
  } else {
    command = `/usr/bin/nc ${host} ${port}`;
  }

  if (relayHost) {
    const relayTarget = relayUser ? `${relayUser}@${relayHost}` : relayHost;
    return `ssh -t ${relayTarget} ${shellSingleQuote(command)}`;
  }

  return command;
}

export function buildLaunchSpec(command, options = {}) {
  const platform = options.platform ?? process.platform;
  const hasBinary = options.hasBinary ?? defaultHasBinary;
  const terminal = options.terminal ?? "iterm";

  if (platform === "darwin") {
    if (terminal === "terminal-app") {
      return {
        command: "/usr/bin/osascript",
        args: [
          "-e",
          'tell application "Terminal" to activate',
          "-e",
          'tell application "Terminal" to do script ' + JSON.stringify(command),
        ],
      };
    }

    return {
      command: "/usr/bin/osascript",
      args: [
        "-e",
        'tell application "iTerm" to activate',
        "-e",
        'tell application "iTerm" to create window with default profile',
        "-e",
        `tell application "iTerm" to tell current session of current window to write text ${JSON.stringify(command)}`,
      ],
    };
  }

  if (platform === "linux") {
    const candidates = [
      "x-terminal-emulator",
      "gnome-terminal",
      "konsole",
      "xfce4-terminal",
      "xterm",
    ];
    const launcher = candidates.find((candidate) => hasBinary(candidate));
    if (!launcher) {
      throw new Error("No supported terminal launcher found");
    }

    if (launcher === "gnome-terminal") {
      return { command: launcher, args: ["--", "sh", "-lc", command] };
    }

    return { command: launcher, args: ["-e", "sh", "-lc", command] };
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

export function createBridgeServer(options = {}) {
  const dryRun = options.dryRun ?? false;
  const hasBinary = options.hasBinary ?? defaultHasBinary;
  const launch =
    options.launch ??
    ((command, terminal) => {
      const spec = buildLaunchSpec(command, { terminal });
      spawn(spec.command, spec.args, {
        stdio: "ignore",
        detached: true,
      }).unref();
    });

  return http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");

    if (req.method === "OPTIONS" && req.url === "/open-console") {
      res.writeHead(204).end();
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/open-console") {
      res.writeHead(404).end("Not found");
      return;
    }

    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    try {
      const payload = JSON.parse(body);
      const command = buildNativeCommand(payload, { hasBinary });
      if (!dryRun) {
        launch(command, payload.terminal);
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, command }));
    } catch (error) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
  });
}

const isMainModule =
  import.meta.main === true ||
  (process.argv[1] !== undefined &&
    realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(process.argv[1]));

if (isMainModule) {
  const server = createBridgeServer();
  server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
    console.log(
      `Native console bridge listening on http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
    );
  });
}
