import { useEffect, useRef, useState } from "react";
import type {
  AiLabPreview,
  AiProviderSettings,
  AiProviderSettingsView,
} from "@networkchum/shared";

type AiLabBuilderDialogProps = {
  open: boolean;
  onClose: () => void;
  onLoadProvider: () => Promise<AiProviderSettingsView | null>;
  onSaveProvider: (
    settings: AiProviderSettings,
  ) => Promise<AiProviderSettingsView>;
  onPreview: (prompt: string) => Promise<AiLabPreview>;
  onCommit: (input: {
    name: string;
    spec: AiLabPreview["spec"];
  }) => Promise<void>;
};

const PROVIDER_BASE_URL_HINTS: Record<AiProviderSettings["provider"], string> =
  {
    "openai-compatible":
      "https://api.openai.com/v1 — include the version path; also works with LM Studio, Ollama, OpenRouter, LiteLLM",
    anthropic:
      "https://api.anthropic.com — no version path; the API appends /v1/messages",
  };

export function AiLabBuilderDialog({
  open,
  onClose,
  onLoadProvider,
  onSaveProvider,
  onPreview,
  onCommit,
}: AiLabBuilderDialogProps) {
  const [provider, setProvider] =
    useState<AiProviderSettings["provider"]>("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<AiLabPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the loader in a ref so the dialog loads settings once per open even
  // though App re-creates the callback on every render.
  const loadProviderRef = useRef(onLoadProvider);
  loadProviderRef.current = onLoadProvider;

  useEffect(() => {
    if (!open) {
      return;
    }
    setPreview(null);
    setError(null);
    setSavedNotice(false);
    loadProviderRef
      .current()
      .then((settings) => {
        if (!settings) {
          setHasStoredKey(false);
          return;
        }
        setProvider(settings.provider);
        setBaseUrl(settings.baseUrl);
        setModel(settings.model);
        setHasStoredKey(settings.hasApiKey);
      })
      .catch(() => {
        setHasStoredKey(false);
      });
  }, [open]);

  if (!open) {
    return null;
  }

  function currentSettings(): AiProviderSettings {
    return {
      provider,
      baseUrl: baseUrl.trim(),
      model: model.trim(),
      apiKey: apiKey.trim() || null,
    };
  }

  async function handleSaveProvider() {
    setBusy(true);
    setError(null);
    try {
      const settings = currentSettings();
      const view = await onSaveProvider(settings);
      setHasStoredKey(view.hasApiKey);
      setApiKey("");
      setSavedNotice(true);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to save provider settings",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    setSavedNotice(false);
    try {
      const nextPreview = await onPreview(prompt);
      setPreview(nextPreview);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Generation failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!preview?.document) return;
    setBusy(true);
    setError(null);
    try {
      await onCommit({ name: preview.labName, spec: preview.spec });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Commit failed",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Build Lab with AI"
      className="dialog-overlay"
    >
      <div className="dialog ai-dialog">
        <div className="dialog-header">
          <div>
            <p className="panel-eyebrow">Workspace</p>
            <h2>Build Lab with AI</h2>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="ai-provider">
          <label className="field">
            <span className="field-label">Provider</span>
            <select
              className="field-input"
              aria-label="LLM Provider"
              value={provider}
              onChange={(event) =>
                setProvider(
                  event.target.value as AiProviderSettings["provider"],
                )
              }
            >
              <option value="openai-compatible">
                OpenAI-compatible endpoint
              </option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Base URL</span>
            <input
              className="field-input"
              aria-label="LLM Base URL"
              placeholder={PROVIDER_BASE_URL_HINTS[provider]}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Model</span>
            <input
              className="field-input"
              aria-label="LLM Model"
              placeholder="e.g. gpt-4o, claude-sonnet-4-5, llama3"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">API Key</span>
            <input
              className="field-input"
              aria-label="LLM API Key"
              type="password"
              placeholder={hasStoredKey ? "•••• (saved)" : "Required"}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <span className="field-hint">
              Stored in the API data dir; never sent back to the browser.
            </span>
          </label>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !baseUrl.trim() || !model.trim()}
              onClick={() => void handleSaveProvider()}
            >
              Save Provider
            </button>
            {savedNotice ? (
              <span className="field-hint" role="status">
                Provider saved.
              </span>
            ) : null}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Lab Spec</span>
          <textarea
            className="field-input ai-spec-input"
            aria-label="Lab Spec"
            rows={6}
            placeholder="e.g. Two CSR routers connected to one Ubuntu host, all in one subnet"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!prompt.trim() || busy}
            onClick={() => void handlePreview()}
          >
            Generate Lab
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        {preview ? (
          <div className="import-preview">
            <div className="import-summary">
              <strong>{preview.labName}</strong>
              <span>{preview.nodes.length} nodes</span>
              <span>{preview.links.length} links</span>
            </div>
            {preview.issues.length > 0 ? (
              <ul className="import-issues">
                {preview.issues.map((issue, index) => (
                  <li key={`${issue.message}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            ) : null}
            <div
              className="import-table"
              role="table"
              aria-label="AI Lab Nodes"
            >
              {preview.nodes.map((node) => (
                <div className="import-row" role="row" key={node.name}>
                  <span>{node.name}</span>
                  <span>{node.requestedTemplate}</span>
                  <span>
                    {node.displayName ?? "unresolved"}
                    {node.imageBound ? " (image bound)" : ""}
                  </span>
                </div>
              ))}
            </div>
            <ul className="ai-links" aria-label="AI Lab Links">
              {preview.links.map((link) => (
                <li key={link.name}>
                  {link.name}:{" "}
                  {link.members
                    .map(
                      (member) => `${member.node} (if${member.interfaceIndex})`,
                    )
                    .join(", ")}
                </li>
              ))}
            </ul>
            <div className="dialog-actions import-commit-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!preview.document || busy}
                onClick={() => void handleCommit()}
              >
                Create Lab
              </button>
              {!preview.document ? (
                <span className="field-hint">
                  Resolve every node above before creating the lab.
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
