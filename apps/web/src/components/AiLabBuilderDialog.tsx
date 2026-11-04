import { useEffect, useRef, useState } from "react";
import type {
  AiLabPreview,
  AiProviderSettings,
  AiProviderSettingsView,
} from "@networkchum/shared";
import { AI_PROVIDERS, aiProviderDef } from "@networkchum/shared";

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
  onStartLogin: (provider: AiProviderSettings["provider"]) => Promise<{
    mode: "device";
    deviceCode: string;
    verifyUrl: string;
    userCode: string;
    interval: number;
    expiresIn: number;
  }>;
  onPollLogin: (deviceCode: string) => Promise<{
    status: "pending" | "slow_down" | "expired" | "denied" | "connected";
    account?: string | null;
  }>;
  onDisconnect: (provider: AiProviderSettings["provider"]) => Promise<void>;
  onPreview: (prompt: string, devices: Array<string>) => Promise<AiLabPreview>;
  onCommit: (input: {
    name: string;
    spec: AiLabPreview["spec"];
    allowedTemplateIds: Array<string>;
  }) => Promise<void>;
};

const PROVIDER_GROUPS = [
  { id: "subscription", label: "Subscriptions" },
  { id: "api-key", label: "API keys" },
  { id: "local", label: "Local" },
] as const;

export function AiLabBuilderDialog({
  open,
  onClose,
  devices,
  onLoadProvider,
  onSaveProvider,
  onProbeModels,
  onStartLogin,
  onPollLogin,
  onDisconnect,
  onPreview,
  onCommit,
}: AiLabBuilderDialogProps) {
  const [provider, setProvider] =
    useState<AiProviderSettings["provider"]>("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [authMode, setAuthMode] = useState<"key" | "oauth">("key");
  const [authAccount, setAuthAccount] = useState<string | null>(null);
  const [deviceLogin, setDeviceLogin] = useState<{
    deviceCode: string;
    userCode: string;
    verifyUrl: string;
    interval: number;
  } | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
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
  // A slow settings load must not overwrite edits the user already started.
  const providerTouchedRef = useRef(false);
  const probeModelsRef = useRef(onProbeModels);
  probeModelsRef.current = onProbeModels;
  const startLoginRef = useRef(onStartLogin);
  startLoginRef.current = onStartLogin;
  const pollLoginRef = useRef(onPollLogin);
  pollLoginRef.current = onPollLogin;
  const disconnectRef = useRef(onDisconnect);
  disconnectRef.current = onDisconnect;

  useEffect(() => {
    if (!open) {
      return;
    }
    setPreview(null);
    setError(null);
    setSavedNotice(false);
    setModelOptions([]);
    setDetectError(null);
    setDeviceLogin(null);
    setAuthError(null);
    setSigningIn(false);
    providerTouchedRef.current = false;
    loadProviderRef
      .current()
      .then((settings) => {
        if (!settings) {
          setHasStoredKey(false);
          return;
        }
        if (providerTouchedRef.current) {
          return;
        }
        setProvider(settings.provider);
        setBaseUrl(settings.baseUrl);
        setModel(settings.model);
        setHasStoredKey(settings.hasApiKey);
        setAuthMode(settings.authMode);
        setAuthAccount(settings.account);
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

  useEffect(() => {
    if (!deviceLogin) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const result = await pollLoginRef.current(deviceLogin.deviceCode);
        if (cancelled) {
          return;
        }
        if (result.status === "connected") {
          setDeviceLogin(null);
          setAuthMode("oauth");
          setAuthAccount(result.account ?? null);
          setHasStoredKey(true);
          setAuthError(null);
          void detectModels(
            {
              provider,
              baseUrl: baseUrl.trim() || aiProviderDef(provider).baseUrl,
            },
            true,
          );
          return;
        }
        if (result.status === "expired") {
          setDeviceLogin(null);
          setAuthError("The sign-in code expired — try again.");
          return;
        }
        if (result.status === "denied") {
          setDeviceLogin(null);
          setAuthError("Sign-in was denied.");
          return;
        }
        const wait =
          result.status === "slow_down"
            ? deviceLogin.interval + 5
            : deviceLogin.interval;
        timer = setTimeout(() => void tick(), wait * 1000);
      } catch (nextError) {
        if (!cancelled) {
          setDeviceLogin(null);
          setAuthError(
            nextError instanceof Error ? nextError.message : "Sign-in failed",
          );
        }
      }
    };
    timer = setTimeout(() => void tick(), deviceLogin.interval * 1000);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [deviceLogin]);

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

  function handleProviderChange(next: AiProviderSettings["provider"]) {
    providerTouchedRef.current = true;
    const current = baseUrl.trim();
    const previousDefault = aiProviderDef(provider).baseUrl;
    const nextDefault = aiProviderDef(next).baseUrl;
    setProvider(next);
    setModelOptions([]);
    setDetectError(null);
    setAuthError(null);
    setDeviceLogin(null);
    // Subscription providers have a fixed endpoint; do not keep probing a
    // previous custom URL (for example a local LLM) after switching to them.
    const nextDef = aiProviderDef(next);
    const switchingToSubscription =
      nextDef.auth === "oauth-device" &&
      Boolean(nextDefault) &&
      !current.startsWith(new URL(nextDefault).origin);
    const switchingProvider =
      Boolean(nextDefault) && (!current || current === previousDefault);
    if (switchingProvider || switchingToSubscription) {
      setBaseUrl(nextDefault);
    }
  }

  async function handleStartLogin() {
    setSigningIn(true);
    setAuthError(null);
    try {
      setDeviceLogin(await startLoginRef.current(provider));
    } catch (nextError) {
      setAuthError(
        nextError instanceof Error
          ? nextError.message
          : "Sign-in could not start",
      );
    } finally {
      setSigningIn(false);
    }
  }

  async function handleDisconnect() {
    setAuthError(null);
    try {
      await disconnectRef.current(provider);
      setAuthMode("key");
      setAuthAccount(null);
      setHasStoredKey(false);
    } catch (nextError) {
      setAuthError(
        nextError instanceof Error ? nextError.message : "Could not sign out",
      );
    }
  }

  async function handleSaveProvider() {
    setBusy(true);
    setError(null);
    try {
      const settings = currentSettings();
      const view = await onSaveProvider(settings);
      setHasStoredKey(view.hasApiKey);
      setAuthMode(view.authMode);
      setAuthAccount(view.account);
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
                handleProviderChange(
                  event.target.value as AiProviderSettings["provider"],
                )
              }
            >
              {PROVIDER_GROUPS.map((group) => (
                <optgroup key={group.id} label={group.label}>
                  {AI_PROVIDERS.filter((entry) => entry.group === group.id).map(
                    (entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ),
                  )}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Base URL</span>
            <input
              className="field-input"
              aria-label="LLM Base URL"
              placeholder={
                aiProviderDef(provider).baseUrl || "https://your-endpoint/v1"
              }
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            <span className="field-hint">{aiProviderDef(provider).hint}</span>
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
                  : "e.g. gpt-5.3-codex, claude-sonnet-4-5, llama3"
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
          {aiProviderDef(provider).supportsApiKey ? (
            <label className="field">
              <span className="field-label">API Key</span>
              <input
                className="field-input"
                aria-label="LLM API Key"
                type="password"
                placeholder={
                  hasStoredKey || authMode === "oauth"
                    ? "•••• (saved)"
                    : aiProviderDef(provider).auth === "key"
                      ? "Required"
                      : "Optional when signed in"
                }
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
              <span className="field-hint">
                Stored in the API data dir; never sent back to the browser.
              </span>
            </label>
          ) : null}
          {aiProviderDef(provider).auth === "oauth-device" ? (
            <div className="field">
              <span className="field-label">
                {aiProviderDef(provider).label}
              </span>
              {authMode === "oauth" ? (
                <>
                  <span className="field-hint" role="status">
                    Signed in{authAccount ? ` as ${authAccount}` : ""} —
                    requests are billed to your {aiProviderDef(provider).label}{" "}
                    plan.
                  </span>
                  <div className="dialog-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy}
                      onClick={() => void handleDisconnect()}
                    >
                      Sign out
                    </button>
                  </div>
                </>
              ) : deviceLogin ? (
                <>
                  <span className="field-hint" role="status">
                    Enter code <strong>{deviceLogin.userCode}</strong> at{" "}
                    <a
                      href={deviceLogin.verifyUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {deviceLogin.verifyUrl}
                    </a>{" "}
                    — waiting for approval…
                  </span>
                  <div className="dialog-actions">
                    <a
                      className="btn btn-secondary"
                      href={deviceLogin.verifyUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open sign-in page
                    </a>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setDeviceLogin(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="field-hint">
                    Sign in with your {aiProviderDef(provider).label} account to
                    use it without an API key.
                  </span>
                  <div className="dialog-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={signingIn}
                      onClick={() => void handleStartLogin()}
                    >
                      {signingIn ? "Starting…" : "Sign in"}
                    </button>
                  </div>
                </>
              )}
              {authError ? (
                <span className="form-error">{authError}</span>
              ) : null}
            </div>
          ) : null}
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
