import { describe, expect, it, vi } from "vitest";

import { callLlm, openCodeModelsUrl, probeModels } from "./llmClient.js";

const opencodeSettings = {
  provider: "opencode-go" as const,
  baseUrl: "https://opencode.ai/inference/go/openai/v1",
  model: "glm-5.3",
  apiKey: "oc_sk_test",
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("OpenCode Go provider", () => {
  it("derives the catalog URL from the chat base URL", () => {
    expect(openCodeModelsUrl(opencodeSettings.baseUrl)).toBe(
      "https://opencode.ai/inference/go/v1/models",
    );
  });

  it("sends the bearer token and client headers on chat requests", async () => {
    const fetcher = vi.fn(async () =>
      json({ choices: [{ message: { content: "{}" } }] }),
    );

    await callLlm({
      settings: opencodeSettings,
      messages: [{ role: "user", content: "hi" }],
      fetcher: fetcher as unknown as typeof fetch,
      opencode: { sessionId: "session-1", orgId: "org-1" },
    });

    const [url, init] = fetcher.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe(
      "https://opencode.ai/inference/go/openai/v1/chat/completions",
    );
    expect(init.headers).toMatchObject({
      authorization: "Bearer oc_sk_test",
      "user-agent": "networkchum",
      "x-opencode-session": "session-1",
      "x-org-id": "org-1",
    });
  });

  it("probes the Go catalog endpoint", async () => {
    const fetcher = vi.fn(async () =>
      json({ object: "list", data: [{ id: "glm-5.3" }, { id: "kimi-k3" }] }),
    );

    const models = await probeModels({
      provider: "opencode-go",
      baseUrl: opencodeSettings.baseUrl,
      apiKey: opencodeSettings.apiKey,
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(models).toEqual(["glm-5.3", "kimi-k3"]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://opencode.ai/inference/go/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer oc_sk_test",
        }),
      }),
    );
  });
});
