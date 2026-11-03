import type { AiProviderKind, AiProviderSettings } from "@networkchum/shared";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

/**
 * The Go gateway serves chat completions under `/openai/v1` but publishes its
 * model catalog at `/v1/models`, so derive the catalog URL from the base.
 */
export function openCodeModelsUrl(baseUrl: string): string {
  const root = baseUrl
    .replace(/\/+$/, "")
    .replace(/\/(openai|anthropic)\/v1$/, "");
  return `${root}/v1/models`;
}

export function authHeadersFor(
  provider: AiProviderKind,
  apiKey: string | null,
): Record<string, string> {
  if (!apiKey) {
    return {};
  }
  return provider === "anthropic"
    ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
    : { authorization: `Bearer ${apiKey}` };
}

/**
 * OpenCode asks clients to identify themselves and to send a stable session id
 * per conversation so it can route requests and reuse prompt caches.
 */
export function opencodeHeaders(input?: {
  sessionId?: string;
  orgId?: string;
}): Record<string, string> {
  return {
    "user-agent": "networkchum",
    ...(input?.sessionId ? { "x-opencode-session": input.sessionId } : {}),
    ...(input?.orgId ? { "x-org-id": input.orgId } : {}),
  };
}

function truncate(text: string, maxLength = 300): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}…`;
}

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

type AnthropicMessagesResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `LLM provider returned non-JSON response: ${truncate(text)}`,
    );
  }
}

/**
 * Call the configured LLM and return its text output. Both provider flavors
 * use the plain messages shape; the system message is sent in the position
 * each protocol expects.
 */
export async function callLlm(input: {
  settings: AiProviderSettings;
  messages: LlmMessage[];
  fetcher: typeof fetch;
  maxTokens?: number;
  opencode?: { sessionId?: string; orgId?: string };
}): Promise<string> {
  const { settings, messages, fetcher } = input;
  const maxTokens = input.maxTokens ?? 8192;
  const extraHeaders =
    settings.provider === "opencode-go" ? opencodeHeaders(input.opencode) : {};
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const turns = messages.filter((message) => message.role !== "system");

  let response: Response;
  if (settings.provider === "anthropic") {
    response = await fetcher(joinUrl(settings.baseUrl, "v1/messages"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeadersFor(settings.provider, settings.apiKey),
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: settings.model,
        system,
        messages: turns.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
        max_tokens: maxTokens,
        ...(settings.temperature !== undefined
          ? { temperature: Math.min(1, settings.temperature) }
          : {}),
      }),
    });
  } else {
    response = await fetcher(joinUrl(settings.baseUrl, "chat/completions"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeadersFor(settings.provider, settings.apiKey),
        ...extraHeaders,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        ...(settings.temperature !== undefined
          ? { temperature: settings.temperature }
          : {}),
      }),
    });
  }

  if (!response.ok) {
    throw new Error(
      `LLM provider responded ${response.status}: ${truncate(
        await response.text(),
      )}`,
    );
  }

  const payload = await readResponseJson(response);

  if (settings.provider === "anthropic") {
    const data = payload as AnthropicMessagesResponse;
    const text = (data.content ?? [])
      .filter(
        (block) => block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text ?? "")
      .join("");
    if (!text) {
      throw new Error("LLM response did not contain any text content");
    }
    return text;
  }

  const data = payload as OpenAiChatResponse;
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text) {
    throw new Error("LLM response did not contain any message content");
  }
  return text;
}

type ModelsListResponse = {
  data?: Array<{ id?: string; display_name?: string }>;
  models?: Array<{ id?: string; name?: string }>;
};

function extractModelIds(payload: unknown): Array<string> {
  const models = payload as ModelsListResponse;
  const fromOpenAiShape = (models.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const fromAltShape = (models.models ?? [])
    .map((entry) => entry.id ?? entry.name)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set([...fromOpenAiShape, ...fromAltShape])].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  );
}

/**
 * Detect the models an endpoint serves. OpenAI-compatible servers list them
 * at `{baseUrl}/models` (some deployments only at `/v1/models`, so try both);
 * Anthropic lists them at `{baseUrl}/v1/models`. Throws with the reason when
 * the endpoint cannot be probed.
 */
export async function probeModels(input: {
  provider: AiProviderKind;
  baseUrl: string;
  apiKey: string | null;
  fetcher: typeof fetch;
  opencode?: { sessionId?: string; orgId?: string };
}): Promise<Array<string>> {
  const paths =
    input.provider === "anthropic"
      ? ["v1/models"]
      : input.provider === "opencode-go"
        ? [openCodeModelsUrl(input.baseUrl)]
        : ["models", "v1/models"];
  const extraHeaders =
    input.provider === "opencode-go" ? opencodeHeaders(input.opencode) : {};
  let emptyList = false;

  for (const path of paths) {
    const response = await input.fetcher(joinUrl(input.baseUrl, path), {
      headers: {
        ...authHeadersFor(input.provider, input.apiKey),
        ...extraHeaders,
      },
    });
    if (response.status === 404 || response.status === 405) {
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `Model detection failed: the endpoint responded ${response.status}`,
      );
    }
    const payload = await readResponseJson(response);
    const ids = extractModelIds(payload);
    if (ids.length > 0) {
      return ids;
    }
    emptyList = true;
  }

  throw new Error(
    emptyList
      ? "The endpoint returned an empty model list"
      : "Model detection failed: the endpoint did not expose a model list",
  );
}
