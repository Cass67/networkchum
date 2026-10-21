import { useEffect, useRef, useState } from "react";
import type {
  AiLabPreview,
  AiProviderSettings,
  AiProviderSettingsView,
} from "@networkchum/shared";

export type AiDeviceOption = {
  id: string;
  name: string;
  runtime?: string;
  imageId?: string | null;
};

type AiLabBuilderDialogProps = {
  open: boolean;
  onClose: () => void;
  devices: Array<AiDeviceOption>;
  onLoadProvider: () => Promise<AiProviderSettingsView | null>;
  onSaveProvider: (
    settings: AiProviderSettings,
  ) => Promise<AiProviderSettingsView>;
  onProbeModels: (input: {
    provider: AiProviderSettings["provider"];
    baseUrl: string;
    apiKey?: string | null;
  }) => Promise<{ models: Array<string> }>;
  onPreview: (prompt: string, devices: Array<string>) => Promise<AiLabPreview>;
  onCommit: (input: {
    name: string;
    spec: AiLabPreview["spec"];
    allowedTemplateIds: Array<string>;
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
  devices,
  onLoadProvider,
  onSaveProvider,
  onProbeModels,
  onPreview,
  onCommit,
}: AiLabBuilderDialogProps) {
  const [provider, setProvider] =
    useState<AiProviderSettings["provider"]>("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [modelOptions, setModelOptions] = useState<Array<string>>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [preview, setPreview] = useState<AiLabPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the loader in a ref so the dialog loads settings once per open even
  // though App re-creates the callback on every render.
  const loadProviderRef = useRef(onLoadProvider);
  loadProviderRef.current = onLoadProvider;
  const probeModelsRef = useRef(onProbeModels);
  probeModelsRef.current = onProbeModels;

  useEffect(() => {
    if (!open) {
      return;
    }
    setPreview(null);
    setError(null);
    setSavedNotice(false);
    setModelOptions([]);
    setDetectError(null);
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
        // Saved endpoint: detect the model list automatically; the key stays
        // server-side, so probe with the stored key.
        if (settings.baseUrl) {
          void detectModels(
            { provider: settings.provider, baseUrl: settings.baseUrl },
            true,
          );
        }
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

  async function detectModels(
    input: { provider: AiProviderSettings["provider"]; baseUrl: string },
    silent = false,
  ) {
    setDetecting(true);
    if (!silent) {
      setDetectError(null);
    }
    try {
      const { models } = await probeModelsRef.current({
        provider: input.provider,
        baseUrl: input.baseUrl,
        // A typed draft key wins; null tells the API to use the stored key.
        apiKey: apiKey.trim() || null,
      });
      setModelOptions(models);
      if (!silent) {
        setDetectError(null);
      }
    } catch (nextError) {
      if (!silent) {
        setDetectError(
          nextError instanceof Error
            ? nextError.message
            : "Model detection failed",
        );
      }
    } finally {
      setDetecting(false);
    }
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

  function toggleDevice(deviceId: string) {
    setSelectedDeviceIds((current) => {
      const next = new Set(current);
      if (next.has(deviceId)) {
        next.delete(deviceId);
      } else {
        next.add(deviceId);
      }
      return next;
    });
    // The preview was generated for a different device set; drop it so the
    // operator regenerates against the new selection.
    setPreview(null);
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    setSavedNotice(false);
    try {
      const selectedDevices = devices
        .filter((device) => selectedDeviceIds.has(device.id))
        .map((device) => device.id);
      const nextPreview = await onPreview(prompt, selectedDevices);
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
      await onCommit({
        name: preview.labName,
        spec: preview.spec,
        allowedTemplateIds: [
          ...new Set(
            preview.nodes
              .map((node) => node.templateId)
              .filter((id): id is string => Boolean(id)),
          ),
        ],
      });
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
              list="ai-model-options"
              placeholder={
                modelOptions.length > 0
                  ? `${modelOptions.length} models detected — pick or type one`
                  : "e.g. gpt-4o, claude-sonnet-4-5, llama3"
              }
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
            <datalist id="ai-model-options">
              {modelOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </label>
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={detecting || !baseUrl.trim()}
              onClick={() =>
                void detectModels({ provider, baseUrl: baseUrl.trim() })
              }
            >
              {detecting ? "Detecting…" : "Detect Models"}
            </button>
            {modelOptions.length > 0 ? (
              <span className="field-hint" role="status">
                {modelOptions.length} models detected
              </span>
            ) : null}
            {detectError ? (
              <span className="form-error">{detectError}</span>
            ) : null}
          </div>
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

        {devices.length > 0 ? (
          <fieldset className="ai-devices">
            <span className="field-label">Devices</span>
            <span className="field-hint">
              Optional: hand-pick the exact devices and the AI wires only these
              into the lab; leave everything unchecked to let the AI choose from
              the whole catalog.
            </span>
            <div className="ai-device-list">
              {devices.map((device) => (
                <label key={device.id} className="field-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedDeviceIds.has(device.id)}
                    onChange={() => toggleDevice(device.id)}
                  />
                  <span>
                    {device.name}
                    {device.runtime === "container"
                      ? " (container)"
                      : device.imageId
                        ? " (image bound)"
                        : " (no image)"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <label className="field">
          <span className="field-label">Lab Spec</span>
          <textarea
            className="field-input ai-spec-input"
            aria-label="Lab Spec"
            rows={6}
            placeholder="e.g. Build an MPLS lab at CCNP level: two CSR routers running OSPF+LDP core, one Arista switch as CE, plus an Ubuntu test host — and write full device configs"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <span className="field-hint">
            Config generation covers the day-0 injectable platforms: Cisco
            IOSv/vIOS, IOS-XE (CSR/Catalyst), IOS-XR (XRv/XRv9k), NX-OS, Arista
            vEOS, Juniper (vMX, vRR, cRPD, vSRX), FortiGate, and VyOS. Other
            devices still get topology and links; their configs would not apply
            at boot (the preview flags them).
          </span>
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
                  <span>
                    {node.startupConfig
                      ? node.configInjectMethod
                        ? `config ✓ (${node.configInjectMethod})`
                        : "config saved, NOT injectable"
                      : "no config"}
                  </span>
                </div>
              ))}
            </div>
            {preview.nodes.some((node) => node.startupConfig) ? (
              <div className="ai-configs">
                {preview.nodes
                  .filter((node) => node.startupConfig)
                  .map((node) => (
                    <details key={node.name}>
                      <summary>
                        {node.name} config ({node.startupConfig!.length} chars,{" "}
                        {node.configInjectMethod ?? "not injectable"})
                      </summary>
                      <pre className="ai-config-text">{node.startupConfig}</pre>
                    </details>
                  ))}
              </div>
            ) : null}
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
