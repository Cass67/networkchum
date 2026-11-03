import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadAiProviderSettings,
  saveAiProviderSettings,
  toProviderSettingsView,
} from "./providerSettingsStore.js";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), "networkchum-provider-"));
  process.env.NETWORKCHUM_DATA_DIR = dataDir;
});

afterEach(() => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe("provider settings store", () => {
  it("keeps the API key file private and never returns the key", () => {
    saveAiProviderSettings({
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1",
      apiKey: "sk-test-not-real",
    });

    const file = path.join(dataDir, "ai-provider.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const view = toProviderSettingsView(loadAiProviderSettings()!);
    expect(view.hasApiKey).toBe(true);
    expect(view.authMode).toBe("key");
    expect(JSON.stringify(view)).not.toContain("sk-test-not-real");
  });

  it("reports OAuth credentials without exposing them", () => {
    saveAiProviderSettings({
      provider: "opencode-go",
      baseUrl: "https://opencode.ai/inference/go/openai/v1",
      model: "",
      apiKey: null,
    });

    const view = toProviderSettingsView(loadAiProviderSettings()!, {
      account: "cass@example.com",
    });
    expect(view).toMatchObject({
      authMode: "oauth",
      account: "cass@example.com",
      hasApiKey: false,
    });
  });
});
