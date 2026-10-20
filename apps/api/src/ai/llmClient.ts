import type { AiProviderSettings } from "@networkchum/shared";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
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
}): Promise<string> {
  const { settings, messages, fetcher } = input;
  const maxTokens = input.maxTokens ?? 4096;
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
        "anthropic-version": "2023-06-01",
        ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {}),
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
        ...(settings.apiKey
          ? { authorization: `Bearer ${settings.apiKey}` }
          : {}),
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
