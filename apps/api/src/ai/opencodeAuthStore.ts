import {
  chmodSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { z } from "zod";

import { getDataFile } from "../storagePaths.js";

const OpenCodeAuthSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  // Epoch milliseconds.
  expiresAt: z.number(),
  orgId: z.string().optional(),
  account: z.string().optional(),
});

export type OpenCodeAuth = z.infer<typeof OpenCodeAuthSchema>;

function authFile(): string {
  return getDataFile("opencode-auth.json");
}

export function loadOpenCodeAuth(): OpenCodeAuth | null {
  if (!existsSync(authFile())) {
    return null;
  }

  try {
    const parsed = OpenCodeAuthSchema.safeParse(
      JSON.parse(readFileSync(authFile(), "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveOpenCodeAuth(auth: OpenCodeAuth): void {
  const parsed = OpenCodeAuthSchema.parse(auth);
  writeFileSync(authFile(), JSON.stringify(parsed, null, 2), { mode: 0o600 });
  chmodSync(authFile(), 0o600);
}

export function clearOpenCodeAuth(): void {
  rmSync(authFile(), { force: true });
}
