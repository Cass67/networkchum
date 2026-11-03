import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pollOauth, resolveOauth, startOauth } from "./oauthFlows.js";
import { loadOauthRecord, saveOauthRecord } from "./oauthStore.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "networkchum-oauth-"));
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

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.sig`;
}

describe("ChatGPT device sign-in", () => {
  it("starts the device flow and reports the code", async () => {
    const fetcher = vi.fn(async () =>
      json({
        device_auth_id: "device-auth-1",
        user_code: "ABCD-1234",
        interval: "5",
      }),
    );

    const login = await startOauth(
      "chatgpt",
      fetcher as unknown as typeof fetch,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://auth.openai.com/api/accounts/deviceauth/usercode",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        }),
      }),
    );
    expect(login).toMatchObject({
      mode: "device",
      userCode: "ABCD-1234",
      verifyUrl: "https://auth.openai.com/codex/device",
      interval: 5,
    });
  });

  it("polls pending, exchanges the code, and stores the account", async () => {
    const idToken = jwt({
      email: "cass@example.com",
      "https://api.openai.com/auth": { chatgpt_account_id: "acct-1" },
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ device_auth_id: "device-auth-1", user_code: "ABCD-1234" }),
      )
      .mockResolvedValueOnce(json({}, 403))
      .mockResolvedValueOnce(
        json({
          authorization_code: "auth-code",
          code_verifier: "verifier",
        }),
      )
      .mockResolvedValueOnce(
        json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          id_token: idToken,
        }),
      );

    const login = await startOauth(
      "chatgpt",
      fetcher as unknown as typeof fetch,
    );
    if (login.mode !== "device") {
      throw new Error("expected a device flow");
    }

    await expect(
      pollOauth(login.deviceCode, fetcher as unknown as typeof fetch),
    ).resolves.toEqual({ status: "pending" });

    await expect(
      pollOauth(login.deviceCode, fetcher as unknown as typeof fetch),
    ).resolves.toMatchObject({
      status: "connected",
      account: "cass@example.com",
    });

    const exchange = fetcher.mock.calls[3] as unknown as [
      string,
      { body: string },
    ];
    expect(exchange[0]).toBe("https://auth.openai.com/oauth/token");
    expect(exchange[1].body).toContain("grant_type=authorization_code");
    expect(exchange[1].body).toContain("code=auth-code");

    expect(loadOauthRecord("chatgpt")).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      account: "cass@example.com",
      accountId: "acct-1",
    });
    expect(statSync(path.join(dataDir, "ai-oauth.json")).mode & 0o777).toBe(
      0o600,
    );
  });
});

describe("OpenCode device sign-in", () => {
  it("starts the flow and resolves the relative verification URL", async () => {
    const fetcher = vi.fn(async () =>
      json({
        device_code: "opencode-device",
        user_code: "WXYZ-9876",
        verification_uri_complete: "/console/device?user_code=WXYZ-9876",
        expires_in: 600,
        interval: 5,
      }),
    );

    const login = await startOauth(
      "opencode-go",
      fetcher as unknown as typeof fetch,
    );

    expect(login).toMatchObject({
      mode: "device",
      userCode: "WXYZ-9876",
      verifyUrl: "https://opencode.ai/console/device?user_code=WXYZ-9876",
    });
  });

  it("refreshes an expiring credential", async () => {
    saveOauthRecord("opencode-go", {
      accessToken: "old",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 1000,
      account: "cass@example.com",
    });
    const fetcher = vi.fn(async () =>
      json({
        access_token: "new",
        refresh_token: "refresh-2",
        expires_in: 3600,
      }),
    );

    const auth = await resolveOauth(
      "opencode-go",
      fetcher as unknown as typeof fetch,
    );

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
    expect(loadOauthRecord("opencode-go")?.refreshToken).toBe("refresh-2");
  });
});
