import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { z } from "zod";

import { getDataFile } from "../storagePaths.js";

/**
 * OAuth credentials for subscription providers, keyed by provider id. One file
 * (mode 0600) rather than one file per provider so sign-out and inspection stay
 * simple.
 */
const OauthRecordSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  // Epoch milliseconds.
  expiresAt: z.number(),
  account: z.string().optional(),
  /** Provider-specific account id (ChatGPT sends this as a header). */
  accountId: z.string().optional(),
  orgId: z.string().optional(),
});

const OauthFileSchema = z.record(z.string(), OauthRecordSchema);

export type OauthRecord = z.infer<typeof OauthRecordSchema>;

function oauthFile(): string {
  return getDataFile("ai-oauth.json");
}

function legacyOpencodeFile(): string {
  return getDataFile("opencode-auth.json");
}

function readAll(): Record<string, OauthRecord> {
  if (!existsSync(oauthFile())) {
    // Import the short-lived per-provider file from the first OpenCode build.
    if (existsSync(legacyOpencodeFile())) {
      try {
        const legacy = OauthRecordSchema.safeParse(
          JSON.parse(readFileSync(legacyOpencodeFile(), "utf8")),
        );
        if (legacy.success) {
          const migrated = { "opencode-go": legacy.data };
          saveAll(migrated);
          rmSync(legacyOpencodeFile(), { force: true });
          return migrated;
        }
      } catch {
        // Fall through to an empty store.
      }
    }
    return {};
  }

  try {
    const parsed = OauthFileSchema.safeParse(
      JSON.parse(readFileSync(oauthFile(), "utf8")),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function saveAll(records: Record<string, OauthRecord>): void {
  writeFileSync(oauthFile(), JSON.stringify(records, null, 2), {
    mode: 0o600,
  });
  chmodSync(oauthFile(), 0o600);
}

export function loadOauthRecord(providerId: string): OauthRecord | null {
  return readAll()[providerId] ?? null;
}

export function saveOauthRecord(providerId: string, record: OauthRecord): void {
  saveAll({ ...readAll(), [providerId]: OauthRecordSchema.parse(record) });
}

export function clearOauthRecord(providerId: string): void {
  const records = readAll();
  if (!(providerId in records)) {
    return;
  }
  delete records[providerId];
  if (Object.keys(records).length === 0) {
    rmSync(oauthFile(), { force: true });
    return;
  }
  saveAll(records);
}
