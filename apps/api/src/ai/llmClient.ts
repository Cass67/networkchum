import type { AiProviderKind, AiProviderSettings } from "@networkchum/shared";
import { aiProviderDef, aiProviderProtocol } from "@networkchum/shared";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmOauthContext = {
  accountId?: string;
  orgId?: string;
  sessionId?: string;
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

function providerHeaders(
  settings: AiProviderSettings,
  oauth?: LlmOauthContext,
): Record<string, string> {
  const headers = authHeadersFor(settings.provider, settings.apiKey);
  if (settings.provider === "opencode-go") {
    // OpenCode asks clients to identify themselves and to send a stable
    // session id per conversation so it can route and cache prompts.
    headers["user-agent"] = "networkchum";
    if (oauth?.sessionId) {
      headers["x-opencode-session"] = oauth.sessionId;
    }
    if (oauth?.orgId) {
      headers["x-org-id"] = oauth.orgId;
    }
  }
  if (settings.provider === "chatgpt") {
    headers["user-agent"] = "networkchum";
    headers.originator = "networkchum";
    headers["OpenAI-Beta"] = "responses=experimental";
    if (oauth?.accountId) {
      headers["chatgpt-account-id"] = oauth.accountId;
    }
    if (oauth?.sessionId) {
      headers.session_id = oauth.sessionId;
    }
  }
  return headers;
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

type ResponsesPayload = {
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
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

function extractResponsesText(payload: ResponsesPayload): string {
  const parts: Array<string> = [];
  for (const item of payload.output ?? []) {
    for (const block of item.content ?? []) {
      if (block.type === "output_text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("");
}

/**
 * Codex streams Server-Sent Events; the text arrives as `output_text.delta`
 * events and the completed response carries the full output as a fallback.
 */
export function parseCodexStream(raw: string): string {
  let text = "";
  let completedText = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = event.type;
    if (
      type === "response.output_text.delta" &&
      typeof event.delta === "string"
    ) {
      text += event.delta;
    } else if (type === "response.completed") {
      const response = event.response as ResponsesPayload | undefined;
      completedText = response ? extractResponsesText(response) : "";
    } else if (type === "response.failed" || type === "error") {
      const response = event.response as ResponsesPayload | undefined;
      throw new Error(
        `ChatGPT request failed: ${
          response?.error?.message ??
          (typeof event.message === "string" ? event.message : "unknown error")
        }`,
      );
    }
  }

  const output = text || completedText;
  if (!output) {
    throw new Error("ChatGPT response did not contain any text output");
  }
  return output;
}

async function callCodexResponses(input: {
  settings: AiProviderSettings;
  messages: LlmMessage[];
  fetcher: typeof fetch;
  oauth?: LlmOauthContext;
}): Promise<string> {
  const { settings, messages, fetcher } = input;
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const turns = messages.filter((message) => message.role !== "system");

  const response = await fetcher(joinUrl(settings.baseUrl, "responses"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...providerHeaders(settings, input.oauth),
    },
    body: JSON.stringify({
      model: settings.model,
      instructions: system,
      input: turns.map((message) => ({
        type: "message",
        role: message.role === "assistant" ? "assistant" : "user",
        content: [
          {
            type: message.role === "assistant" ? "output_text" : "input_text",
            text: message.content,
          },
        ],
      })),
      store: false,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `LLM provider responded ${response.status}: ${truncate(
        await response.text(),
      )}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as ResponsesPayload;
    if (payload.error?.message) {
      throw new Error(`ChatGPT request failed: ${payload.error.message}`);
    }
    const text = extractResponsesText(payload);
    if (!text) {
      throw new Error("ChatGPT response did not contain any text output");
    }
    return text;
  }

  return parseCodexStream(await response.text());
}

/**
 * Call the configured LLM and return its text output. The system message is
 * sent in the position each protocol expects.
 */
export async function callLlm(input: {
  settings: AiProviderSettings;
  messages: LlmMessage[];
  fetcher: typeof fetch;
  maxTokens?: number;
  oauth?: LlmOauthContext;
}): Promise<string> {
  const { settings, messages, fetcher } = input;
  const protocol = aiProviderProtocol(settings.provider);

  if (protocol === "codex-responses") {
    return callCodexResponses(input);
  }

  const maxTokens = input.maxTokens ?? 8192;
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const turns = messages.filter((message) => message.role !== "system");

  let response: Response;
  if (protocol === "anthropic-messages") {
    response = await fetcher(joinUrl(settings.baseUrl, "v1/messages"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...providerHeaders(settings, input.oauth),
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
        ...providerHeaders(settings, input.oauth),
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

  if (protocol === "anthropic-messages") {
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
 * Detect the models an endpoint serves. Subscription providers have no public
 * catalog, so they report their known model ids. OpenAI-compatible servers list
 * them at `{baseUrl}/models` (some deployments only at `/v1/models`);
 * Anthropic lists them at `{baseUrl}/v1/models`.
 */
export async function probeModels(input: {
  provider: AiProviderKind;
  baseUrl: string;
  apiKey: string | null;
  fetcher: typeof fetch;
  oauth?: LlmOauthContext;
}): Promise<Array<string>> {
  const def = aiProviderDef(input.provider);
  if (def.defaultModels) {
    return def.defaultModels;
  }

  const paths =
    input.provider === "anthropic"
      ? ["v1/models"]
      : input.provider === "opencode-go"
        ? [openCodeModelsUrl(input.baseUrl)]
        : ["models", "v1/models"];
  const headers = providerHeaders(
    {
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: "",
      apiKey: input.apiKey,
    },
    input.oauth,
  );
  let emptyList = false;

  for (const path of paths) {
    const response = await input.fetcher(joinUrl(input.baseUrl, path), {
      headers,
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
