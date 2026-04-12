# NetworkChum Distribution & Packaging Plan

**Date:** 2026-04-12
**Platforms:** macOS, Linux
**Model:** Paid annual subscription, single-user, no auto-update, per-user license (2 machines), online validation + 1-day offline grace, custom license server

---

## Constraints & Assumptions

- Windows excluded — requires hypervisor, not supported
- Linux requires KVM/QEMU hypervisor on host (documented prerequisite, not bundled)
- macOS requires appropriate network permissions (TAP/bridge via sudo or capabilities)
- Single binary target — no separate Vite dev server in production
- No code signing budget assumed — document gatekeeper bypass for macOS

---

## Current Architecture

Three separate processes today:

| Process               | Port | Notes                                      |
| --------------------- | ---- | ------------------------------------------ |
| Fastify API           | 4000 | TypeScript, needs sudo/root for TAP/bridge |
| Vite dev server       | 5173 | React frontend, proxies `/api` → 4000      |
| Native console bridge | 4010 | Plain Node.js, spawns terminal emulators   |

No static file serving in API. Frontend only served by Vite dev server (dev mode only).

---

## Phase 1 — Consolidate into Single Production Process

**Goal:** API serves frontend statically. No Vite server in production.

### 1A. API serves built frontend

- Add `@fastify/static` to `apps/api` dependencies
- In production mode (`NODE_ENV=production`), mount static plugin to serve `web/dist/` at `/`
- Configure SPA fallback: unknown routes return `index.html` (required for client-side routing)
- Dev mode unchanged — Vite proxy continues to work as-is

### 1B. Frontend URL resolution

- `runtimeUrls.ts` already resolves API URL from `window.location` — no proxy needed when same origin
- Bridge URL hardcoded to port 4010 — verify this still resolves correctly in production build
- If `window.location.hostname` is used, bridge URL becomes `<host>:4010` — correct for both localhost and LAN modes

### 1C. Console bridge — separate binary

- `tools/native-console-bridge/server.js` stays as a separate process
- Compile separately with `bun build --compile` → `networkchum-bridge` binary
- API spawns bridge as a child process on startup (or launcher script starts both)
- Already bound to `127.0.0.1:4010` — no config change needed
- Bridge is macOS/Linux only by design (iTerm, gnome-terminal, etc.) — fine

---

## Phase 2 — Build Pipeline

**Goal:** One command produces distributable binaries.

### 2A. Verify `bun build --compile` with monorepo

Before committing to this approach, run a test build:

```sh
bun build apps/api/src/server.ts --compile --outfile /tmp/networkchum-test
```

Check:

- `@networkchum/shared` path alias resolves (tsconfig paths → bun bundler)
- Binary starts and serves requests
- No dynamic `require()` or `__dirname` issues

If path alias fails: add a pre-build step that runs `tsc` on shared first, then point bun at compiled output.

### 2B. Build script (`build:dist`)

New script added to root `package.json`:

```
build:dist
  1. npm run build                              # compile shared + api TS, build vite
  2. cp -r apps/web/dist apps/api/dist/public  # stage frontend into api
  3. bun build apps/api/src/server.ts \
       --compile \
       --outfile dist/networkchum             # compile API binary (embeds Bun runtime)
  4. bun build tools/native-console-bridge/server.js \
       --compile \
       --outfile dist/networkchum-bridge      # compile bridge binary
```

### 2C. Output

```
dist/
  networkchum          ← main binary (API + embedded frontend)
  networkchum-bridge   ← console bridge binary
```

### 2D. Data directory

- Default: `~/.local/share/networkchum/` on Linux, `~/Library/Application Support/NetworkChum/` on macOS
- Set via `NETWORKCHUM_DATA_DIR` env var (already supported)
- Installer creates this directory on first install

---

## Phase 3 — Code Protection

JavaScript/TypeScript cannot be fully protected — accept this. Goal: raise cost of casual theft.

### 3A. Bun compile (do regardless)

- Output contains Bun IR bytecode, not readable source
- No TypeScript visible
- `strings` on binary won't reveal logic, only string literals
- Cost: zero

### 3B. Frontend obfuscation

- Vite minifies + mangles names by default — already decent
- Add [javascript-obfuscator](https://github.com/javascript-obfuscator/javascript-obfuscator) as Vite plugin for stronger protection
- Options: control flow flattening, string array encoding, dead code injection
- Trade-off: ~20-40% larger bundle, slightly slower parse
- Note: frontend code is always inspectable in browser DevTools regardless — keep critical logic server-side

### 3C. License enforcement

See Phase 3B (License System) below.

### 3D. What remains readable

- System call strings (`ip`, `tc`, `socat`, etc.) — acceptable, it's metadata
- Port numbers, env var names — acceptable
- Frontend rendered HTML/JS — unavoidable in any web app

---

## Phase 3B — License System

**Model:** Paid per-user key. You generate and email keys to users. App validates online against your server. 1-day offline grace. App refuses to run if invalid or grace expired.

### License server — custom (self-hosted)

Simple REST API + database you own and control. No third-party SaaS dependency. Runs cheaply on any VPS (Fly.io, Railway, DigitalOcean, etc.).

**Stack:**

- Runtime: Bun + Fastify (same stack as the app)
- Database: SQLite via `bun:sqlite` (single file, zero ops, survives deploys via mounted volume)
- Hosting: **Fly.io** — free tier (256MB RAM, shared CPU, 3GB persistent volume), built-in TLS, custom domain (`license.networkchum.io`), `fly deploy` from CLI

**License server schema:**

```sql
CREATE TABLE licenses (
  id         TEXT PRIMARY KEY,          -- internal UUID
  key        TEXT UNIQUE NOT NULL,      -- key mailed to user (e.g. NC-XXXX-XXXX-XXXX-XXXX)
  email      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active', -- active | revoked | expired
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,            -- created_at + 1 year
  note       TEXT                      -- optional: order ID, customer name
);

CREATE TABLE activations (
  id           TEXT PRIMARY KEY,
  license_id   TEXT NOT NULL REFERENCES licenses(id),
  fingerprint  TEXT NOT NULL,          -- SHA-256 of machine ID
  platform     TEXT NOT NULL,          -- 'macos' | 'linux'
  activated_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE(license_id, fingerprint)
);
```

**License server endpoints:**

```
POST /validate
  Body: { key, fingerprint, platform }
  Logic:
    1. Look up key
    2. If not found → { valid: false, reason: "NOT_FOUND" }
    3. If status = revoked → { valid: false, reason: "REVOKED" }
    4. If expires_at < now → { valid: false, reason: "EXPIRED" }
    5. Count activations for this license
       - If fingerprint already registered → update last_seen_at, allow
       - If fingerprint new AND activation count < 2 → insert, allow
       - If fingerprint new AND activation count >= 2 → { valid: false, reason: "TOO_MANY_MACHINES" }
    6. Return { valid: true, email, expires_at }

POST /deactivate
  Body: { key, fingerprint }
  Removes activation record (user self-service or admin use)
```

**Admin interface:** Simple CLI or private HTTP endpoint protected by a secret header. Operations: create key, revoke key, list activations, extend expiry.

**Key format:** `NC-XXXX-XXXX-XXXX-XXXX` (NC = NetworkChum prefix, cryptographically random, uppercase alphanumeric, no ambiguous chars like 0/O/1/I)

**Key generation (admin script):**

```js
function generateKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const segment = () =>
    Array.from(
      { length: 4 },
      () => chars[Math.floor(Math.random() * chars.length)],
    ).join("");
  return `NC-${segment()}-${segment()}-${segment()}-${segment()}`;
}
```

### Flow on startup

```
1. Read license key from data dir (~/.local/share/networkchum/license.key or macOS equivalent)
2. If no key found → print error with purchase URL, exit 1
3. If key found → call keygen.sh validation endpoint
   a. Valid response → cache {validated_at: now, key: ...} to disk, start app
   b. Network error / timeout → check cached validated_at
      - If < 24 hours ago → allow start, log "offline grace period active"
      - If >= 24 hours ago → print error, exit 1
   c. Invalid/revoked/expired response → delete cache, print error, exit 1
4. Re-validate every 12 hours while app is running (background timer)
   - Same grace logic applies if network unavailable during re-check
   - If re-check fails hard (revoked) → graceful shutdown with message
```

### License cache file

Store in `NETWORKCHUM_DATA_DIR`:

```json
{
  "key": "XXXX-XXXX-XXXX-XXXX",
  "validated_at": "2026-04-12T10:00:00Z",
  "email": "user@example.com",
  "expiry": null
}
```

Cache is not a trust boundary — server is authoritative. Cache only used for offline grace.

### App → license server call

```
POST https://license.networkchum.io/validate
Content-Type: application/json

{
  "key": "NC-XXXX-XXXX-XXXX-XXXX",
  "fingerprint": "<sha256-of-machine-id>",
  "platform": "macos"
}
```

Response:

```json
{ "valid": true, "email": "user@example.com", "expires_at": "2027-04-12T00:00:00Z" }
{ "valid": false, "reason": "EXPIRED" }
{ "valid": false, "reason": "TOO_MANY_MACHINES" }
{ "valid": false, "reason": "NOT_FOUND" }
{ "valid": false, "reason": "REVOKED" }
```

App handles each reason with a specific error message. Network timeout/5xx → fall through to offline grace logic.

### Machine fingerprint

Generate from:

- macOS: `system_profiler SPHardwareDataType` → Hardware UUID
- Linux: `/etc/machine-id` or `/var/lib/dbus/machine-id`

SHA-256 hash before sending. Store hash in license cache (never raw hardware ID).

2-machine limit enforced server-side via `activations` table.

### License key input UX

App is a web UI — add a license activation page:

- On first run (no key stored), API returns a `402 License Required` on all routes
- Frontend detects this and shows a license activation screen
- User enters their key + email
- Frontend POSTs to `/api/license/activate`
- API validates with keygen.sh, stores key to disk, returns success
- Frontend redirects to normal app

### Where validation lives

**All in the API (backend).** Never validate in the frontend — it can be bypassed.

Add a Fastify plugin that runs before all routes:

- Checks license state in memory (cached from startup + background re-check)
- If invalid: returns `402` with JSON error body
- Frontend shows activation/error screen

### Error messages to show user

| Situation            | Message                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| No key               | "No license key found. Purchase at [URL] then run `networkchum --activate <key>`" |
| Invalid key          | "License key invalid or revoked. Contact support."                                |
| Expired              | "License expired. Renew your annual subscription at [URL]."                       |
| Too many machines    | "Machine limit reached. Deactivate another machine at [URL] or upgrade."          |
| Grace period active  | Warning log only — don't bother user unless grace expires                         |
| Grace period expired | "Could not validate license for 24+ hours. Connect to the internet to continue."  |

### CLI activation alternative

For headless/server installs (no browser):

```sh
networkchum --activate XXXX-XXXX-XXXX-XXXX
```

Stores key, validates, prints result. Useful for Linux server installs.

### Implementation notes

- License validation code lives entirely in `apps/api` — no frontend code involved
- Add `apps/api/src/license/` module: `validate.ts`, `cache.ts`, `fingerprint.ts`
- Fastify plugin: `apps/api/src/plugins/license.ts` — registers before routes
- License server URL embedded at build time via `bun build --define` (e.g. `https://license.networkchum.io`)
- No secret token needed in the binary — `/validate` endpoint is public (rate-limited by IP on the server side)

---

## Phase 4 — macOS Installer

**Format:** `.pkg` via `pkgbuild` + `productbuild` (Xcode CLI tools, no extra install needed)

### Package contents

```
/usr/local/bin/networkchum
/usr/local/bin/networkchum-bridge
~/Library/Application Support/NetworkChum/   (created by postinstall)
```

### Postinstall script

```sh
#!/bin/sh
mkdir -p "$HOME/Library/Application Support/NetworkChum"
```

### Privilege model

macOS does not support `setcap`. Options for TAP/bridge:

- **Option A (simple):** Document that `sudo networkchum` is required for bridge/TAP features. Acceptable for a CLI network tool.
- **Option B (proper):** Install a privileged helper via `SMJobBless` + XPC. Complex, requires Apple Developer account for signing.

**Recommendation:** Option A for now. Add a clear error message in the API if TAP ops fail due to permissions.

### Gatekeeper (no code signing)

Without an Apple Developer account, macOS will block the binary. Document workaround:

```sh
xattr -dr com.apple.quarantine /usr/local/bin/networkchum
xattr -dr com.apple.quarantine /usr/local/bin/networkchum-bridge
```

Or install via the `.pkg` — packages from `productbuild` trigger a different (less aggressive) gatekeeper path.

**Future:** If Apple Developer account obtained, `codesign` + `notarytool` eliminates this entirely.

### Build script (macOS)

```sh
pkgbuild \
  --root ./pkg-root \
  --identifier com.networkchum.app \
  --version 1.0.0 \
  --scripts ./pkg-scripts \
  networkchum.pkg

productbuild \
  --package networkchum.pkg \
  --distribution distribution.xml \
  NetworkChum-1.0.0-macos.pkg
```

---

## Phase 5 — Linux Installer

**Format:** `.deb` (Debian/Ubuntu) + `.rpm` (RHEL/Fedora/Arch via AUR) via [fpm](https://github.com/jordansissel/fpm)

### Package contents

```
/usr/bin/networkchum
/usr/bin/networkchum-bridge
/etc/systemd/system/networkchum.service   (optional, for auto-start)
/var/lib/networkchum/                     (created by postinstall)
```

### Privilege model

Linux is cleaner than macOS for network capabilities:

```sh
# Postinstall: grant specific capabilities instead of running as root
setcap cap_net_admin,cap_net_raw+ep /usr/bin/networkchum
```

This allows TAP/bridge creation without `sudo`. Verify this covers all network ops used (`ip`, `tc`, bridge creation).

Fallback: document `sudo networkchum` if setcap is insufficient.

### Systemd unit (optional, single-user)

```ini
[Unit]
Description=NetworkChum Network Lab

[Service]
ExecStart=/usr/bin/networkchum
ExecStartPost=/usr/bin/networkchum-bridge
Restart=on-failure
User=%i

[Install]
WantedBy=default.target
```

Since single-user: install as a user service (`~/.config/systemd/user/`) rather than system service.

### Build commands

```sh
# .deb
fpm -s dir -t deb \
  -n networkchum \
  -v 1.0.0 \
  --after-install scripts/postinstall.sh \
  dist/networkchum=/usr/bin/networkchum \
  dist/networkchum-bridge=/usr/bin/networkchum-bridge

# .rpm
fpm -s dir -t rpm \
  -n networkchum \
  -v 1.0.0 \
  --after-install scripts/postinstall.sh \
  dist/networkchum=/usr/bin/networkchum \
  dist/networkchum-bridge=/usr/bin/networkchum-bridge
```

---

## Phase 6 — Distribution

No app store, no auto-update. Simple file distribution.

### GitHub Releases (recommended)

- Tag release → `v1.0.0`
- Attach: `NetworkChum-1.0.0-macos.pkg`, `networkchum_1.0.0_amd64.deb`, `networkchum-1.0.0.x86_64.rpm`
- Optional: checksums file (`sha256sums.txt`)
- `install.sh` (already exists) can be updated to download from GitHub releases

### Architecture targets

- macOS: `arm64` (Apple Silicon) + `x86_64` (Intel) — produce both, or universal binary via lipo
- Linux: `x86_64` primary, `arm64` secondary (Raspberry Pi, ARM servers)

Bun compile produces architecture-specific binaries. Need to build on each target arch, or use cross-compilation if Bun supports it.

---

## Implementation Order

| #   | Task                                                        | Notes                                     |
| --- | ----------------------------------------------------------- | ----------------------------------------- |
| 1   | Test `bun build --compile` with monorepo                    | Validate before building everything on it |
| 2   | Add `@fastify/static`, serve `web/dist/` from API           | Gate on `NODE_ENV=production`             |
| 3   | Verify `runtimeUrls.ts` works single-origin in prod build   | Manual browser test                       |
| 4   | Wire bridge: API spawns bridge child process                | Or update launcher script                 |
| 5   | Write `build:dist` script                                   | Orchestrates steps 1-4                    |
| 6   | Add javascript-obfuscator Vite plugin                       | Config + verify bundle size impact        |
| 7   | License module: `validate.ts`, `cache.ts`, `fingerprint.ts` | keygen.sh REST calls, cache logic         |
| 8   | Fastify license plugin — gates all routes                   | Returns 402 if invalid                    |
| 9   | Frontend license activation screen                          | POSTs to `/api/license/activate`          |
| 10  | CLI `--activate` flag for headless installs                 | Linux server use case                     |
| 11  | Embed keygen.sh tokens via `bun build --define`             | Keep tokens out of source                 |
| 12  | macOS `.pkg` build script + postinstall                     | `pkgbuild` + `productbuild`               |
| 13  | Linux `.deb` + `.rpm` via fpm                               | `setcap` postinstall                      |
| 14  | Test install on clean macOS VM                              | Verify gatekeeper, license flow, paths    |
| 15  | Test install on clean Ubuntu + Fedora VM                    | Verify `setcap`, license flow             |
| 16  | GitHub Release workflow (manual or CI)                      | Tag → attach artifacts                    |

---

## Open Questions

1. **Bun compile + monorepo aliases** — needs a test build to confirm before committing to this approach
2. **Bridge spawn model** — should API spawn bridge as child process, or keep them as separate launch targets in the installer?
3. **macOS universal binary** — build separate arm64/x86_64 binaries or use `lipo` to combine? (universal is ~2x size)
4. **Linux `setcap` coverage** — does `cap_net_admin,cap_net_raw` cover all network operations, or does the app shell out to `ip`/`tc` (in which case setcap on the binary doesn't help)?
5. ~~Machine limit~~ → **2 machines per license**
6. ~~Expiry model~~ → **Annual subscription** (key expires after 1 year, renewal = new key emailed)
7. ~~keygen.sh vs roll-your-own~~ → **custom license server** (you email keys, validate against your own endpoint)
