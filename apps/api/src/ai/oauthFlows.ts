import { randomUUID } from "node:crypto";

import type { AiProviderKind } from "@networkchum/shared";

import type { OauthRecord } from "./oauthStore.js";
import { loadOauthRecord, saveOauthRecord } from "./oauthStore.js";

/**
 * Subscription sign-in flows. ChatGPT and OpenCode use RFC 8628 device codes,
 * which work when the API runs on another machine; Claude uses an
 * authorization-code flow whose callback is pasted back into the dialog.
 *
 * The client ids are the public first-party ids these vendors ship in their own
 * CLIs (Codex, OpenCode, Claude Code); NetworkChum presents itself through the
 * user agent and does not register its own OAuth app.
 */
type Fetcher = typeof fetch;

const OPENCODE_CONSOLE = "https://opencode.ai/console";
const OPENCODE_CLIENT_ID = "opencode-cli";
export const OPENCODE_GO_BASE_URL =
  "https://opencode.ai/inference/go/openai/v1";

const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CHATGPT_DEVICE_CODE_URL =
  "https://auth.openai.com/api/accounts/deviceauth/usercode";
const CHATGPT_DEVICE_TOKEN_URL =
  "https://auth.openai.com/api/accounts/deviceauth/token";
const CHATGPT_VERIFY_URL = "https://auth.openai.com/codex/device";
const CHATGPT_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";
const CHATGPT_TOKEN_URL = "https://auth.openai.com/oauth/token";

const USER_AGENT = "networkchum";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export type OauthStart =
  | {
      mode: "device";
      deviceCode: string;
      verifyUrl: string;
      userCode: string;
      interval: number;
      expiresIn: number;
    }
  | { mode: "paste"; verifyUrl: string };

export type OauthPoll =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "connected"; account: string | null };

type PendingDevice = {
  provider: AiProviderKind;
  deviceAuthId: string;
  userCode: string;
  interval: number;
  expiresAt: number;
};

// Sign-ins in flight. Single-user server, so a process-local map is enough;
// a restart just means the user starts the sign-in again.
const pendingDevices = new Map<string, PendingDevice>();
const FLOW_TTL_MS = 15 * 60 * 1000;

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, flow] of pendingDevices) {
    if (flow.expiresAt < now) {
      pendingDevices.delete(id);
    }
  }
}

function base64url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function parseJwtClaims(token: string): {
  exp?: number;
  email?: string;
  chatgpt_account_id?: string;
  organizations?: Array<{ id?: string }>;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
    account_id?: string;
  };
} {
  const part = token.split(".")[1];
  if (!part) {
    return {};
  }
  try {
    return JSON.parse(
      Buffer.from(
        part.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    ) as ReturnType<typeof parseJwtClaims>;
  } catch {
    return {};
  }
}

function accountFromJwt(token: string): string | undefined {
  const claims = parseJwtClaims(token);
  const auth = claims["https://api.openai.com/auth"];
  return (
    auth?.chatgpt_account_id ??
    auth?.account_id ??
    claims.chatgpt_account_id ??
    claims.organizations?.[0]?.id
  );
}

function expiryFromToken(token: string, expiresIn?: number): number {
  const exp = parseJwtClaims(token).exp;
  if (typeof exp === "number" && exp > 0) {
    return exp * 1000;
  }
  return Date.now() + (expiresIn ?? 3600) * 1000;
}

async function postJson(
  fetcher: Fetcher,
  url: string,
  body: unknown,
): Promise<Response> {
  return fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
}

async function postForm(
  fetcher: Fetcher,
  url: string,
  body: Record<string, string>,
): Promise<Response> {
  return fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": USER_AGENT,
    },
    body: new URLSearchParams(body).toString(),
  });
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.trim().slice(0, 300);
}

export async function startOauth(
  provider: AiProviderKind,
  fetcher: Fetcher,
): Promise<OauthStart> {
  pruneExpired();

  if (provider === "chatgpt") {
    const response = await postJson(fetcher, CHATGPT_DEVICE_CODE_URL, {
      client_id: CHATGPT_CLIENT_ID,
    });
    if (!response.ok) {
      throw new Error(
        `ChatGPT sign-in could not start (${response.status}). ${await errorText(response)}`,
      );
    }
    const payload = (await response.json()) as {
      device_auth_id?: string;
      user_code?: string;
      interval?: string | number;
    };
    if (!payload.device_auth_id || !payload.user_code) {
      throw new Error("ChatGPT sign-in returned an incomplete device code");
    }
    const interval = Number(payload.interval ?? 5) || 5;
    const deviceCode = randomUUID();
    pendingDevices.set(deviceCode, {
      provider,
      deviceAuthId: payload.device_auth_id,
      userCode: payload.user_code,
      interval,
      expiresAt: Date.now() + FLOW_TTL_MS,
    });
    return {
      mode: "device",
      deviceCode,
      verifyUrl: CHATGPT_VERIFY_URL,
      userCode: payload.user_code,
      interval,
      expiresIn: Math.round(FLOW_TTL_MS / 1000),
    };
  }

  if (provider === "opencode-go") {
    const response = await postJson(
      fetcher,
      `${OPENCODE_CONSOLE}/auth/device/code`,
      { client_id: OPENCODE_CLIENT_ID, supports_org_scope: true },
    );
    if (!response.ok) {
      throw new Error(
        `OpenCode sign-in could not start (${response.status}). ${await errorText(response)}`,
      );
    }
    const payload = (await response.json()) as {
      device_code?: string;
      user_code?: string;
      verification_uri_complete?: string;
      expires_in?: number;
      interval?: number;
    };
    if (!payload.device_code || !payload.user_code) {
      throw new Error("OpenCode sign-in returned an incomplete device code");
    }
    const deviceCode = randomUUID();
    pendingDevices.set(deviceCode, {
      provider,
      deviceAuthId: payload.device_code,
      userCode: payload.user_code,
      interval: payload.interval ?? 5,
      expiresAt: Date.now() + FLOW_TTL_MS,
    });
    return {
      mode: "device",
      deviceCode,
      verifyUrl: new URL(
        payload.verification_uri_complete ?? "/console/device",
        "https://opencode.ai",
      ).href,
      userCode: payload.user_code,
      interval: payload.interval ?? 5,
      expiresIn: payload.expires_in ?? 600,
    };
  }

  throw new Error(`${provider} does not support sign-in`);
}

async function storeAndReport(
  provider: AiProviderKind,
  record: OauthRecord,
): Promise<OauthPoll> {
  saveOauthRecord(provider, record);
  return { status: "connected", account: record.account ?? null };
}

export async function pollOauth(
  deviceCode: string,
  fetcher: Fetcher,
): Promise<OauthPoll> {
  const pending = pendingDevices.get(deviceCode);
  if (!pending) {
    return { status: "expired" };
  }

  if (pending.provider === "chatgpt") {
    const response = await postJson(fetcher, CHATGPT_DEVICE_TOKEN_URL, {
      device_auth_id: pending.deviceAuthId,
      user_code: pending.userCode,
    });
    if (response.status === 403 || response.status === 404) {
      return { status: "pending" };
    }
    if (!response.ok) {
      throw new Error(
        `ChatGPT sign-in failed (${response.status}). ${await errorText(response)}`,
      );
    }
    const payload = (await response.json()) as {
      authorization_code?: string;
      code_verifier?: string;
    };
    if (!payload.authorization_code || !payload.code_verifier) {
      throw new Error("ChatGPT sign-in returned an incomplete authorization");
    }
    pendingDevices.delete(deviceCode);

    const tokenResponse = await postForm(fetcher, CHATGPT_TOKEN_URL, {
      grant_type: "authorization_code",
      code: payload.authorization_code,
      redirect_uri: CHATGPT_REDIRECT_URI,
      client_id: CHATGPT_CLIENT_ID,
      code_verifier: payload.code_verifier,
    });
    if (!tokenResponse.ok) {
      throw new Error(
        `ChatGPT token exchange failed (${tokenResponse.status}). ${await errorText(tokenResponse)}`,
      );
    }
    const tokens = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
    };
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("ChatGPT token exchange returned an incomplete response");
    }
    const idClaims = parseJwtClaims(tokens.id_token ?? "");
    return storeAndReport("chatgpt", {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: expiryFromToken(tokens.access_token, tokens.expires_in),
      account: idClaims.email,
      accountId:
        accountFromJwt(tokens.id_token ?? "") ??
        accountFromJwt(tokens.access_token),
    });
  }

  if (pending.provider === "opencode-go") {
    const response = await postJson(
      fetcher,
      `${OPENCODE_CONSOLE}/auth/device/token`,
      {
        grant_type: DEVICE_GRANT,
        device_code: pending.deviceAuthId,
        client_id: OPENCODE_CLIENT_ID,
      },
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      switch (payload.error) {
        case "authorization_pending":
          return { status: "pending" };
        case "slow_down":
          return { status: "slow_down" };
        case "expired_token":
          pendingDevices.delete(deviceCode);
          return { status: "expired" };
        case "access_denied":
        case "authorization_denied":
          pendingDevices.delete(deviceCode);
          return { status: "denied" };
        default:
          throw new Error(
            `OpenCode sign-in failed (${response.status}). ${await errorText(response)}`,
          );
      }
    }
    pendingDevices.delete(deviceCode);
    const tokens = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      org_id?: string | null;
    };
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("OpenCode sign-in returned an incomplete token response");
    }
    return storeAndReport("opencode-go", {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      orgId: tokens.org_id ?? undefined,
      account: await opencodeAccount(tokens.access_token, fetcher),
    });
  }

  throw new Error("this provider does not use a device code");
}

async function opencodeAccount(
  accessToken: string,
  fetcher: Fetcher,
): Promise<string | undefined> {
  try {
    const response = await fetcher(`${OPENCODE_CONSOLE}/api/user`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "user-agent": USER_AGENT,
      },
    });
    if (!response.ok) {
      return undefined;
    }
    const payload = (await response.json()) as { email?: string; id?: string };
    return payload.email ?? payload.id;
  } catch {
    return undefined;
  }
}

async function refreshRecord(
  provider: AiProviderKind,
  record: OauthRecord,
  fetcher: Fetcher,
): Promise<OauthRecord> {
  if (!record.refreshToken) {
    throw new Error("Sign in again: this credential cannot be refreshed");
  }

  let response: Response;
  if (provider === "chatgpt") {
    response = await postForm(fetcher, CHATGPT_TOKEN_URL, {
      grant_type: "refresh_token",
      client_id: CHATGPT_CLIENT_ID,
      refresh_token: record.refreshToken,
    });
  } else if (provider === "opencode-go") {
    response = await postJson(
      fetcher,
      `${OPENCODE_CONSOLE}/auth/device/token`,
      {
        grant_type: "refresh_token",
        refresh_token: record.refreshToken,
        client_id: OPENCODE_CLIENT_ID,
      },
    );
  } else {
    throw new Error(`${provider} does not use OAuth`);
  }

  if (response.status === 400 || response.status === 401) {
    throw new Error("Sign-in expired. Sign in again in the AI Lab Builder.");
  }
  if (!response.ok) {
    throw new Error(
      `Token refresh failed (${response.status}). Sign in again.`,
    );
  }
  const tokens = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    org_id?: string | null;
  };
  if (!tokens.access_token) {
    throw new Error("Token refresh returned an incomplete response");
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? record.refreshToken,
    expiresAt: expiryFromToken(tokens.access_token, tokens.expires_in),
    account:
      parseJwtClaims(tokens.id_token ?? "").email ??
      record.account ??
      parseJwtClaims(tokens.access_token).email,
    accountId:
      accountFromJwt(tokens.id_token ?? "") ??
      record.accountId ??
      accountFromJwt(tokens.access_token),
    orgId: tokens.org_id ?? record.orgId,
  };
}

/**
 * Return a usable credential, refreshing it when it is within five minutes of
 * expiry. Null means the user has not signed in for this provider.
 */
export async function resolveOauth(
  provider: AiProviderKind,
  fetcher: Fetcher,
): Promise<OauthRecord | null> {
  const record = loadOauthRecord(provider);
  if (!record) {
    return null;
  }
  if (record.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return record;
  }
  const refreshed = await refreshRecord(provider, record, fetcher);
  saveOauthRecord(provider, refreshed);
  return refreshed;
}
