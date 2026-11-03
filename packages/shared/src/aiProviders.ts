import { z } from "zod";

/**
 * Provider registry for the AI Lab Builder. Ids are stored in
 * `ai-provider.json`, so never rename one; add a new id instead.
 */
export const AI_PROVIDER_IDS = [
  "openai-compatible",
  "openai",
  "anthropic",
  "chatgpt",
  "opencode-go",
  "openrouter",
  "groq",
  "deepseek",
  "xai",
  "moonshot",
  "mistral",
  "together",
  "ollama",
  "lmstudio",
] as const;

export const AiProviderKindSchema = z.enum(AI_PROVIDER_IDS);
export type AiProviderKind = z.infer<typeof AiProviderKindSchema>;

/** Wire protocol the provider speaks. */
export type AiProtocol =
  | "openai-chat"
  | "anthropic-messages"
  | "codex-responses";

export type AiAuthMethod = "key" | "oauth-device" | "oauth-paste" | "none";

export type AiProviderDef = {
  id: AiProviderKind;
  label: string;
  group: "subscription" | "api-key" | "local";
  protocol: AiProtocol;
  baseUrl: string;
  auth: AiAuthMethod;
  /** OAuth providers may still accept a key (OpenCode Go does). */
  supportsApiKey: boolean;
  hint: string;
  /** Subscription providers have no public model catalog. */
  defaultModels?: Array<string>;
};

export const AI_PROVIDERS: Array<AiProviderDef> = [
  {
    id: "chatgpt",
    label: "ChatGPT (Plus/Pro)",
    group: "subscription",
    protocol: "codex-responses",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    auth: "oauth-device",
    supportsApiKey: false,
    hint: "Sign in with your ChatGPT account; requests go to the Codex backend.",
    defaultModels: [
      "gpt-5.3-codex",
      "gpt-5.2-codex",
      "gpt-5-codex",
      "gpt-5.1-codex-mini",
    ],
  },
  {
    id: "opencode-go",
    label: "OpenCode Go (subscription)",
    group: "subscription",
    protocol: "openai-chat",
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    auth: "oauth-device",
    supportsApiKey: true,
    hint: "Sign in with OpenCode, or paste an oc_sk_ key.",
  },
  {
    id: "openai",
    label: "OpenAI (API key)",
    group: "api-key",
    protocol: "openai-chat",
    baseUrl: "https://api.openai.com/v1",
    auth: "key",
    supportsApiKey: true,
    hint: "Platform API key from platform.openai.com.",
  },
  {
    id: "anthropic",
    label: "Anthropic (API key)",
    group: "api-key",
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    auth: "key",
    supportsApiKey: true,
    hint: "API key from console.anthropic.com; no version path.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    group: "api-key",
    protocol: "openai-chat",
    baseUrl: "https://openrouter.ai/api/v1",
    auth: "key",
    supportsApiKey: true,
    hint: "One key for many upstream models.",
  },
  {
    id: "groq",
    label: "Groq",
    group: "api-key",
    protocol: "openai-chat",
    baseUrl: "https://api.groq.com/openai/v1",
    auth: "key",
    supportsApiKey: true,
    hint: "Fast open-model inference.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    group: "api-key",
    protocol: "openai-chat",
    baseUrl: "https://api.deepseek.com/v1",
    auth: "key",
    supportsApiKey: true,
    hint: "DeepSeek platform API key.",
  },
  {
    id: "xai",
    label: "xAI",
    group: "api-key",
    protocol: "openai-chat",
    baseUrl: "https://api.x.ai/v1",
    auth: "key",
    supportsApiKey: true,
    hint: "xAI platform API key (SuperGrok sign-in is not wired yet).",
  },
  {
    id: "moonshot",
    label: "Moonshot (Kimi)",
    group: "api-key",
    protocol: "openai-chat",
    baseUrl: "https://api.moonshot.ai/v1",
    auth: "key",
    supportsApiKey: true,
    hint: "Moonshot AI platform key.",
  },
  {
    id: "mistral",
    label: "Mistral",
    group: "api-key",
    protocol: "openai-chat",
    baseUrl: "https://api.mistral.ai/v1",
    auth: "key",
    supportsApiKey: true,
    hint: "Mistral platform key.",
  },
  {
    id: "together",
    label: "Together AI",
    group: "api-key",
    protocol: "openai-chat",
    baseUrl: "https://api.together.xyz/v1",
    auth: "key",
    supportsApiKey: true,
    hint: "Together AI platform key.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    group: "local",
    protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:11434/v1",
    auth: "none",
    supportsApiKey: false,
    hint: "Local Ollama; no key needed.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    group: "local",
    protocol: "openai-chat",
    baseUrl: "http://127.0.0.1:1234/v1",
    auth: "none",
    supportsApiKey: false,
    hint: "Local LM Studio server; no key needed.",
  },
  {
    id: "openai-compatible",
    label: "Custom OpenAI-compatible",
    group: "api-key",
    protocol: "openai-chat",
    baseUrl: "",
    auth: "key",
    supportsApiKey: true,
    hint: "Any OpenAI-compatible endpoint, including LiteLLM and vLLM.",
  },
];

const byId = new Map(AI_PROVIDERS.map((provider) => [provider.id, provider]));

export function aiProviderDef(id: AiProviderKind): AiProviderDef {
  const found = byId.get(id);
  if (!found) {
    throw new Error(`unknown AI provider: ${id}`);
  }
  return found;
}

export function aiProviderProtocol(id: AiProviderKind): AiProtocol {
  return aiProviderDef(id).protocol;
}
