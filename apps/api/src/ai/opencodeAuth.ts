import type { OpenCodeAuth } from "./opencodeAuthStore.js";
import { loadOpenCodeAuth, saveOpenCodeAuth } from "./opencodeAuthStore.js";

/**
 * OpenCode Console device-code login (RFC 8628). OpenCode uses the public
 * `opencode-cli` client for its own CLI and documents device login for
 * third-party clients, so NetworkChum drives the same flow rather than
 * inventing a private client id.
 *
 * The resulting access token is a Bearer token for the Go inference gateway
 * (`https://opencode.ai/inference/go/openai/v1`) and for the Console API.
 */
export const OPENCODE_CONSOLE_BASE = "https://opencode.ai/console";
export const OPENCODE_GO_BASE_URL =
  "https://opencode.ai/inference/go/openai/v1";

const OPENCODE_CLIENT_ID = "opencode-cli";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

type Fetcher = typeof fetch;

type DeviceCodePayload = {
  device_code?: string;
  user_code?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
};

type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  org_id?: string | null;
  error?: string;
};

export type OpenCodeDeviceLogin = {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
};

export type OpenCodePollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "connected"; auth: OpenCodeAuth };

function tokenUrl(): string {
  return `${OPENCODE_CONSOLE_BASE}/auth/device/token`;
}

async function postJson(
  fetcher: Fetcher,
  url: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetcher(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "networkchum",
    },
    body: JSON.stringify(body),
  });
}

export async function startOpenCodeDeviceLogin(
  fetcher: Fetcher,
): Promise<OpenCodeDeviceLogin> {
  const response = await postJson(
    fetcher,
    `${OPENCODE_CONSOLE_BASE}/auth/device/code`,
    { client_id: OPENCODE_CLIENT_ID, supports_org_scope: true },
  );
  if (!response.ok) {
    throw new Error(
      `OpenCode sign-in could not start (${response.status}). Check that the host can reach opencode.ai.`,
    );
  }

  const payload = (await response.json()) as DeviceCodePayload;
  const deviceCode = payload.device_code;
  const userCode = payload.user_code;
  const verification = payload.verification_uri_complete;
  if (!deviceCode || !userCode || !verification) {
    throw new Error("OpenCode sign-in returned an incomplete device code");
  }

  return {
    deviceCode,
    userCode,
    // The API returns a path (`/console/device?...`), not an absolute URL.
    verificationUrl: new URL(verification, "https://opencode.ai").href,
    expiresIn: payload.expires_in ?? 600,
    interval: payload.interval ?? 5,
  };
}

async function readAccount(accessToken: string, fetcher: Fetcher) {
  try {
    const response = await fetcher(`${OPENCODE_CONSOLE_BASE}/api/user`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "user-agent": "networkchum",
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

function toAuth(payload: TokenPayload, previous?: OpenCodeAuth): OpenCodeAuth {
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error("OpenCode sign-in returned an incomplete token response");
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    orgId: payload.org_id ?? previous?.orgId,
    account: previous?.account,
  };
}

export async function pollOpenCodeDeviceLogin(input: {
  deviceCode: string;
  fetcher: Fetcher;
}): Promise<OpenCodePollResult> {
  const response = await postJson(input.fetcher, tokenUrl(), {
    grant_type: DEVICE_GRANT,
    device_code: input.deviceCode,
    client_id: OPENCODE_CLIENT_ID,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as TokenPayload;
    switch (payload.error) {
      case "authorization_pending":
        return { status: "pending" };
      case "slow_down":
        return { status: "slow_down" };
      case "expired_token":
        return { status: "expired" };
      case "access_denied":
      case "authorization_denied":
        return { status: "denied" };
      default:
        throw new Error(
          `OpenCode sign-in failed (${response.status})${payload.error ? `: ${payload.error}` : ""}`,
        );
    }
  }

  const auth = toAuth((await response.json()) as TokenPayload);
  auth.account = await readAccount(auth.accessToken, input.fetcher);
  saveOpenCodeAuth(auth);
  return { status: "connected", auth };
}

export async function refreshOpenCodeAuth(
  auth: OpenCodeAuth,
  fetcher: Fetcher,
): Promise<OpenCodeAuth> {
  const response = await postJson(fetcher, tokenUrl(), {
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken,
    client_id: OPENCODE_CLIENT_ID,
  });

  if (response.status === 400) {
    throw new Error(
      "OpenCode sign-in expired. Sign in to OpenCode again in the AI Lab Builder.",
    );
  }
  if (!response.ok) {
    throw new Error(
      `OpenCode token refresh failed (${response.status}). Sign in again.`,
    );
  }

  const next = toAuth((await response.json()) as TokenPayload, auth);
  next.account = auth.account ?? (await readAccount(next.accessToken, fetcher));
  saveOpenCodeAuth(next);
  return next;
}

/**
 * Return a usable OpenCode credential, refreshing it when it is within five
 * minutes of expiry. Null means the user has not signed in.
 */
export async function resolveOpenCodeAuth(
  fetcher: Fetcher,
): Promise<OpenCodeAuth | null> {
  const auth = loadOpenCodeAuth();
  if (!auth) {
    return null;
  }
  if (auth.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return auth;
  }
  return refreshOpenCodeAuth(auth, fetcher);
}
