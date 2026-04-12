import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLaunchSpec,
  buildNativeCommand,
  createBridgeServer,
} from "./server.js";

test("buildNativeCommand validates supported payloads", () => {
  assert.equal(
    buildNativeCommand(
      { terminal: "iterm", host: "127.0.0.1", port: 5004 },
      { hasBinary: () => false },
    ),
    "/usr/bin/nc 127.0.0.1 5004",
  );
});

test("buildNativeCommand prefers socat for built-in terminals when available", () => {
  assert.equal(
    buildNativeCommand(
      { terminal: "iterm", host: "127.0.0.1", port: 5004 },
      { hasBinary: (name) => name === "socat" },
    ),
    "socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004",
  );
});

test("buildNativeCommand wraps the transport in ssh when relayHost is provided", () => {
  assert.equal(
    buildNativeCommand(
      {
        terminal: "iterm",
        host: "127.0.0.1",
        port: 5004,
        relayHost: "192.168.2.57",
      },
      { hasBinary: (name) => name === "socat" },
    ),
    "ssh -t 192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
  );
});

test("buildNativeCommand includes relayUser in the ssh target when provided", () => {
  assert.equal(
    buildNativeCommand(
      {
        terminal: "iterm",
        host: "127.0.0.1",
        port: 5004,
        relayHost: "192.168.2.57",
        relayUser: "cass",
      },
      { hasBinary: (name) => name === "socat" },
    ),
    "ssh -t cass@192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
  );
});

test("buildNativeCommand rejects unsupported terminals", () => {
  assert.throws(
    () =>
      buildNativeCommand({
        terminal: "terminal",
        host: "127.0.0.1",
        port: 5004,
      }),
    /Unsupported terminal/,
  );
});

test("buildNativeCommand expands custom terminal templates", () => {
  assert.equal(
    buildNativeCommand({
      terminal: "custom",
      template: "ghostty -e /usr/local/bin/telnet {host} {port}",
      host: "127.0.0.1",
      port: 5004,
    }),
    "ghostty -e /usr/local/bin/telnet 127.0.0.1 5004",
  );
});

test("buildNativeCommand rejects malformed custom templates", () => {
  assert.throws(
    () =>
      buildNativeCommand({
        terminal: "custom",
        template: "ghostty -e /usr/local/bin/telnet {host}",
        host: "127.0.0.1",
        port: 5004,
      }),
    /Invalid custom terminal template/,
  );
});

test("buildLaunchSpec uses the macOS launcher path", () => {
  const spec = buildLaunchSpec("/usr/local/bin/telnet 127.0.0.1 5004", {
    platform: "darwin",
  });

  assert.equal(spec.command, "/usr/bin/osascript");
  assert.match(spec.args.join(" "), /iTerm/);
});

test("buildLaunchSpec supports Terminal.app on macOS", () => {
  const spec = buildLaunchSpec("/usr/local/bin/telnet 127.0.0.1 5004", {
    platform: "darwin",
    terminal: "terminal-app",
  });

  assert.equal(spec.command, "/usr/bin/osascript");
  assert.match(spec.args.join(" "), /Terminal/);
});

test("buildLaunchSpec uses the first available linux terminal launcher", () => {
  const spec = buildLaunchSpec("/usr/local/bin/telnet 127.0.0.1 5004", {
    platform: "linux",
    hasBinary: (name) => name === "x-terminal-emulator",
  });

  assert.equal(spec.command, "x-terminal-emulator");
  assert.deepEqual(spec.args, [
    "-e",
    "sh",
    "-lc",
    "/usr/local/bin/telnet 127.0.0.1 5004",
  ]);
});

test("buildLaunchSpec preserves ssh-wrapped commands for gnome-terminal", () => {
  const spec = buildLaunchSpec(
    "ssh -t 192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
    {
      platform: "linux",
      hasBinary: (name) => name === "gnome-terminal",
    },
  );

  assert.equal(spec.command, "gnome-terminal");
  assert.deepEqual(spec.args, [
    "--",
    "sh",
    "-lc",
    "ssh -t 192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
  ]);
});

test("buildLaunchSpec rejects unsupported platforms", () => {
  assert.throws(
    () =>
      buildLaunchSpec("/usr/local/bin/telnet 127.0.0.1 5004", {
        platform: "win32",
      }),
    /Unsupported platform/,
  );
});

test("bridge returns command in dry run mode", async () => {
  const server = createBridgeServer({ dryRun: true, hasBinary: () => false });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/open-console`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ terminal: "iterm", host: "127.0.0.1", port: 5004 }),
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.command, "/usr/bin/nc 127.0.0.1 5004");

  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("bridge returns an ssh-wrapped command in dry run mode when relayHost is provided", async () => {
  const server = createBridgeServer({
    dryRun: true,
    hasBinary: (name) => name === "socat",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/open-console`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      terminal: "iterm",
      host: "127.0.0.1",
      port: 5004,
      relayHost: "192.168.2.57",
    }),
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(
    payload.command,
    "ssh -t 192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
  );

  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("bridge returns an ssh-wrapped command with relayUser in dry run mode", async () => {
  const server = createBridgeServer({
    dryRun: true,
    hasBinary: (name) => name === "socat",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/open-console`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      terminal: "iterm",
      host: "127.0.0.1",
      port: 5004,
      relayHost: "192.168.2.57",
      relayUser: "cass",
    }),
  });

  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(
    payload.command,
    "ssh -t cass@192.168.2.57 'socat STDIO,rawer,echo=0 TCP:127.0.0.1:5004'",
  );

  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("bridge answers CORS preflight for browser requests", async () => {
  const server = createBridgeServer({ dryRun: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/open-console`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://127.0.0.1:5173",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.match(
    response.headers.get("access-control-allow-methods") || "",
    /POST/,
  );

  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("bridge exposes a health endpoint", async () => {
  const server = createBridgeServer({ dryRun: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);

  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
