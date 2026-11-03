import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pollOpenCodeDeviceLogin,
  resolveOpenCodeAuth,
  startOpenCodeDeviceLogin,
} from "./opencodeAuth.js";
import { loadOpenCodeAuth, saveOpenCodeAuth } from "./opencodeAuthStore.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "networkchum-opencode-"));
  process.env.NETWORKCHUM_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenCode device login", () => {
  it("starts the flow and resolves the relative verification URL", async () => {
    const fetcher = vi.fn(async () =>
      json({
        device_code: "device-1",
        user_code: "ABCD-EFGH",
        verification_uri_complete: "/console/device?user_code=ABCD-EFGH",
        expires_in: 600,
        interval: 5,
      }),
    );

    const login = await startOpenCodeDeviceLogin(
      fetcher as unknown as typeof fetch,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://opencode.ai/console/auth/device/code",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_id: "opencode-cli",
          supports_org_scope: true,
        }),
      }),
    );
    expect(login).toMatchObject({
      deviceCode: "device-1",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://opencode.ai/console/device?user_code=ABCD-EFGH",
    });
  });

  it("reports pending, then stores the token with 0600 permissions", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ error: "authorization_pending" }, 400))
      .mockResolvedValueOnce(
        json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          org_id: "org-1",
        }),
      )
      .mockResolvedValueOnce(json({ id: "user-1", email: "cass@example.com" }));

    await expect(
      pollOpenCodeDeviceLogin({
        deviceCode: "device-1",
        fetcher: fetcher as unknown as typeof fetch,
      }),
    ).resolves.toEqual({ status: "pending" });

    await expect(
      pollOpenCodeDeviceLogin({
        deviceCode: "device-1",
        fetcher: fetcher as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({
      status: "connected",
      auth: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        orgId: "org-1",
        account: "cass@example.com",
      },
    });

    const file = path.join(dataDir, "opencode-auth.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(loadOpenCodeAuth()?.refreshToken).toBe("refresh-1");
  });

  it("refreshes a token that is within five minutes of expiry", async () => {
    saveOpenCodeAuth({
      accessToken: "old",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 1000,
      orgId: "org-1",
      account: "cass@example.com",
    });
    const fetcher = vi.fn(async () =>
      json({
        access_token: "new",
        refresh_token: "refresh-2",
        expires_in: 3600,
      }),
    );

    const auth = await resolveOpenCodeAuth(fetcher as unknown as typeof fetch);

    expect(auth?.accessToken).toBe("new");
    expect(fetcher).toHaveBeenCalledWith(
      "https://opencode.ai/console/auth/device/token",
      expect.objectContaining({
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: "refresh-1",
          client_id: "opencode-cli",
        }),
      }),
    );
    expect(loadOpenCodeAuth()?.refreshToken).toBe("refresh-2");
  });

  it("does not refresh a token that is still fresh", async () => {
    saveOpenCodeAuth({
      accessToken: "fresh",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    const fetcher = vi.fn();

    const auth = await resolveOpenCodeAuth(fetcher as unknown as typeof fetch);

    expect(auth?.accessToken).toBe("fresh");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
