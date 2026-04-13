import { useState } from "react";

const roleIconOptions = [
  "router",
  "switch",
  "firewall",
  "cloud",
  "host",
  "client",
] as const;
export type DeviceRoleIcon = (typeof roleIconOptions)[number];

type TemplateSummary = {
  id: string;
  name: string;
  source: string;
  vendor?: string;
  runtime?: string;
  deviceRoleIcon?: DeviceRoleIcon;
  configSchema: {
    ramMb: { default: number; min: number; max: number };
    vcpu: { default: number; min: number; max: number };
    interfaceCount: { default: number; min: number; max: number };
  };
};

type TemplateEditorDialogProps = {
  template: TemplateSummary;
  onSubmit: (input: {
    vcpu: number;
    ramMb: number;
    interfaceCount: number;
    deviceRoleIcon?: DeviceRoleIcon;
  }) => Promise<void>;
  onCancel: () => void;
};

export function TemplateEditorDialog({
  template,
  onSubmit,
  onCancel,
}: TemplateEditorDialogProps) {
  const [vcpu, setVcpu] = useState(String(template.configSchema.vcpu.default));
  const [ramMb, setRamMb] = useState(
    String(template.configSchema.ramMb.default),
  );
  const [interfaceCount, setInterfaceCount] = useState(
    String(template.configSchema.interfaceCount.default),
  );
  const [deviceRoleIcon, setDeviceRoleIcon] = useState<DeviceRoleIcon>(
    template.deviceRoleIcon ?? roleIconOptions[0],
  );
  const [roleIconTouched, setRoleIconTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const nextValues: {
      vcpu: number;
      ramMb: number;
      interfaceCount: number;
      deviceRoleIcon?: DeviceRoleIcon;
    } = {
      vcpu: Number.parseInt(vcpu, 10),
      ramMb: Number.parseInt(ramMb, 10),
      interfaceCount: Number.parseInt(interfaceCount, 10),
    };
    if (roleIconTouched) {
      nextValues.deviceRoleIcon = deviceRoleIcon;
    }

    if (
      Number.isNaN(nextValues.vcpu) ||
      Number.isNaN(nextValues.ramMb) ||
      Number.isNaN(nextValues.interfaceCount)
    ) {
      setError("Enter whole numbers for CPU, RAM, and interfaces.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit(nextValues);
    } catch {
      setError("Failed to save template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-overlay">
      <div
        className="dialog-card"
        role="dialog"
        aria-label={`Edit ${template.name}`}
      >
        <div className="dialog-header">
          <p className="panel-eyebrow">Template Defaults</p>
          <h2>{template.name}</h2>
          <p className="panel-description">
            {template.vendor ?? "Platform"} • {template.source}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>
              <span className="field-label">Role Icon</span>
              <select
                value={deviceRoleIcon}
                onChange={(event) => {
                  setDeviceRoleIcon(event.target.value as DeviceRoleIcon);
                  setRoleIconTouched(true);
                }}
                className="field-input"
                disabled={saving}
              >
                {roleIconOptions.map((role) => (
                  <option key={role} value={role}>
                    {role[0].toUpperCase() + role.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <p className="field-hint">
              Options: Router, Switch, Firewall, Cloud, Host, Client
            </p>
          </div>

          <div className="field">
            <label>
              <span className="field-label">vCPU</span>
              <input
                type="number"
                min={template.configSchema.vcpu.min}
                max={template.configSchema.vcpu.max}
                step={1}
                value={vcpu}
                onChange={(event) => setVcpu(event.target.value)}
                className="field-input"
              />
            </label>
            <p className="field-hint">
              Allowed: {template.configSchema.vcpu.min}-
              {template.configSchema.vcpu.max}
            </p>
          </div>

          <div className="field">
            <label>
              <span className="field-label">RAM (MB)</span>
              <input
                type="number"
                min={template.configSchema.ramMb.min}
                max={template.configSchema.ramMb.max}
                step={1}
                value={ramMb}
                onChange={(event) => setRamMb(event.target.value)}
                className="field-input"
              />
            </label>
            <p className="field-hint">
              Allowed: {template.configSchema.ramMb.min}-
              {template.configSchema.ramMb.max}
            </p>
          </div>

          <div className="field">
            <label>
              <span className="field-label">Interfaces</span>
              <input
                type="number"
                min={template.configSchema.interfaceCount.min}
                max={template.configSchema.interfaceCount.max}
                step={1}
                value={interfaceCount}
                onChange={(event) => setInterfaceCount(event.target.value)}
                className="field-input"
              />
            </label>
            <p className="field-hint">
              Allowed: {template.configSchema.interfaceCount.min}-
              {template.configSchema.interfaceCount.max}
            </p>
          </div>

          {error ? <p className="form-error">{error}</p> : null}

          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={onCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              Save Template
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
