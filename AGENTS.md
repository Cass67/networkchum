# Security Lockdown Rules

Treat all credentials and private material as inaccessible by default.

## Deployment Target (192.168.2.57)

- Production host: `192.168.2.57` (Linux, user `cass`, repo at `~/networkchum`, same `origin` as this checkout).
- The host runs the app as a systemd **user** unit `networkchum.service` with `ExecStart=./start.sh serve`, `NETWORKCHUM_BIND_MODE=lan`, data dir `~/networkchum-data`.
- `start.sh serve` does NOT rebuild; it requires `npm run build` to have been run first.
- Deploy routine: commit and push to `origin` (GitHub), then on the host run `git -C ~/networkchum pull --ff-only && npm run build && systemctl --user restart networkchum`. Verify with `systemctl --user is-active networkchum`, `curl http://192.168.2.57:4000/health`, and the UI on `:5173`.
- The host keeps a local `package-lock.json` drift from npm runs — avoid committing lockfile churn so pulls stay clean.

## Secret Handling

- Never print, quote, summarize, transform, or copy the contents of secrets, keys, tokens, cookies, session files, SSH material, `.env` files, `*env*` files, or credential stores.
- Never place secrets into patches, generated files, logs, test fixtures, examples, commit messages, or command output.
- If a task appears to require a secret, stop and ask the user for permission before reading the specific file or value.
- If a file must be inspected to complete a task, read the minimum scope necessary and redact all sensitive values in any response.
- Use placeholders such as `<REDACTED>`, `${ENV_VAR}`, or example-only dummy values instead of real credentials.

## Files And Paths To Avoid By Default

- Do not access `~/.ssh`, `~/.oci`, `~/.aws`, `~/.config`, `~/.gnupg`, keychains, auth stores, browser profiles, shell history, or any file matching `.env*`, `*env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `auth.json`, `credentials*`, or `secrets*` unless the user explicitly asks for that exact file.
- Do not search the home directory broadly for secrets or credentials unless the user explicitly requests a secret-audit task.
- Treat ignore files such as `.ignore`, `.rgignore`, and `.gitignore` as mandatory search boundaries. Do not bypass them with flags such as `-uu`, `-uuu`, `--hidden`, `--no-ignore`, or equivalent unless the user explicitly asks for that behavior.

## Command Safety

- Avoid commands that echo environment variables, dump config directories, or print full file contents from likely secret-bearing paths.
- Prefer targeted reads over recursive scans.
- When verifying configuration, confirm the presence of a setting without exposing adjacent sensitive values.
- Do not use wildcard reads, recursive `find`, or broad `rg` scans across likely secret-bearing locations when a narrow path or exact filename is sufficient.

## Network And Persistence

- Never send secrets to external services, pastebins, issue trackers, logs, screenshots, or browser forms.
- Do not persist secrets in workspace files unless the user explicitly requests it and names the destination.
- Prefer environment-variable references over inline credential values.

## Editing Rules

- Remove hardcoded secrets if found and replace them with environment-variable references or documented placeholders.
- Keep existing file permissions strict on secret-adjacent files.
- Favor least privilege, least persistence, and redaction in every step.
- If a safer default can be enforced through local config or ignore files, prefer enforcing it instead of relying only on instructions.
