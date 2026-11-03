# NetworkChum Native Console Bridge

A tiny local helper that lets the NetworkChum web UI open a real terminal
window on **your** machine (iTerm, Terminal.app, a Linux terminal, or a Windows
console) instead of the in-browser console.

It listens on `http://127.0.0.1:4010` only. The web UI checks that address from
the browser, so the bridge must run on the machine where you use the browser,
not necessarily on the NetworkChum server.

## Run it

Requires Node.js 22 or newer.

```bash
node server.js
```

or use the launcher for your platform:

```bash
./run.sh          # macOS / Linux
run.cmd           # Windows
```

Keep it running while you use the UI. The header shows `Bridge: Online` when the
UI can reach it.

## Local vs remote

- **NetworkChum on this machine**: the bridge opens a terminal that connects to
  the local QEMU serial port with `socat` (or `nc`).
- **NetworkChum on another host** (the usual case when the server is a VM or a
  LAN box): the UI adds an SSH relay, so the terminal runs
  `ssh -t <user>@<server> 'socat ... TCP:127.0.0.1:<port>'`. You need:
  - an SSH client on this machine (built into Windows 10+, macOS and Linux),
  - SSH access to the server, and
  - `socat` (or `nc`) on the server.
    Set the SSH user in the UI's native console preference if it differs from your
    local user name.

Windows opens a `cmd.exe` console window; macOS uses iTerm or Terminal.app;
Linux uses the first available terminal emulator.

## Security

The bridge only accepts requests from the local machine, validates the target
(`127.0.0.1`/`localhost` plus a port, or a `docker`/`podman exec` command), and
launches a terminal. It does not proxy console bytes itself.
