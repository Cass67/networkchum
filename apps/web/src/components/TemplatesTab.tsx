import { type FormEvent, useEffect, useMemo, useState } from "react";

import type { DeviceRoleIcon } from "../icons/deviceRoleIcons.js";

const roleIconOptions: DeviceRoleIcon[] = [
  "router",
  "switch",
  "firewall",
  "cloud",
  "host",
  "client",
];

type TemplateEntry = {
  id: string;
  name: string;
  vendor?: string;
  runtime?: string;
  deviceRoleIcon?: DeviceRoleIcon;
  configSchema?: {
    ramMb: { default: number; min: number; max: number };
    vcpu: { default: number; min: number; max: number };
    interfaceCount: { default: number; min: number; max: number };
  };
};

type TemplateDefaultsInput = {
  vcpu: number;
  ramMb: number;
  interfaceCount: number;
  deviceRoleIcon?: DeviceRoleIcon;
};

type TemplatesTabProps = {
  templates: TemplateEntry[];
  onSaveTemplate?: (
    templateId: string,
    input: TemplateDefaultsInput,
  ) => Promise<void>;
};

function runtimeLabel(runtime?: string) {
  return runtime === "qemu"
    ? "VM"
    : runtime === "container"
      ? "Container"
      : runtime === "cloud"
        ? "Cloud"
        : "Template";
}

function parseInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function interfaceCountLabel(count: number) {
  return `${count} interface${count === 1 ? "" : "s"}`;
}

export function TemplatesTab({ templates, onSaveTemplate }: TemplatesTabProps) {
  const editableTemplates = useMemo(
    () =>
      templates.filter(
        (template) => template.configSchema && template.runtime === "qemu",
      ),
    [templates],
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    editableTemplates[0]?.id ?? "",
  );
  const selectedTemplate =
    editableTemplates.find((template) => template.id === selectedTemplateId) ??
    editableTemplates[0] ??
    null;
  const [vcpu, setVcpu] = useState("");
  const [ramMb, setRamMb] = useState("");
  const [interfaceCount, setInterfaceCount] = useState("");
  const [deviceRoleIcon, setDeviceRoleIcon] =
    useState<DeviceRoleIcon>("router");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editableTemplates.length) {
      setSelectedTemplateId("");
      return;
    }

    if (
      !selectedTemplateId ||
      !editableTemplates.some((template) => template.id === selectedTemplateId)
    ) {
      setSelectedTemplateId(editableTemplates[0]!.id);
    }
  }, [editableTemplates, selectedTemplateId]);

  useEffect(() => {
    if (!selectedTemplate?.configSchema) {
      setVcpu("");
      setRamMb("");
      setInterfaceCount("");
      setDeviceRoleIcon("router");
      return;
    }

    setVcpu(String(selectedTemplate.configSchema.vcpu.default));
    setRamMb(String(selectedTemplate.configSchema.ramMb.default));
    setInterfaceCount(
      String(selectedTemplate.configSchema.interfaceCount.default),
    );
    setDeviceRoleIcon(selectedTemplate.deviceRoleIcon ?? "router");
    setError(null);
  }, [selectedTemplate]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedTemplate?.configSchema || !onSaveTemplate) {
      return;
    }

    const nextVcpu = parseInteger(vcpu);
    const nextRamMb = parseInteger(ramMb);
    const nextInterfaceCount = parseInteger(interfaceCount);
    if (
      nextVcpu === null ||
      nextRamMb === null ||
      nextInterfaceCount === null
    ) {
      setError("Enter whole numbers for CPU, RAM, and interfaces.");
      return;
    }

    const schema = selectedTemplate.configSchema;
    if (
      nextVcpu < schema.vcpu.min ||
      nextVcpu > schema.vcpu.max ||
      nextRamMb < schema.ramMb.min ||
      nextRamMb > schema.ramMb.max ||
      nextInterfaceCount < schema.interfaceCount.min ||
      nextInterfaceCount > schema.interfaceCount.max
    ) {
      setError("Defaults must stay within the template limits.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSaveTemplate(selectedTemplate.id, {
        vcpu: nextVcpu,
        ramMb: nextRamMb,
        interfaceCount: nextInterfaceCount,
        deviceRoleIcon,
      });
    } catch {
      setError("Failed to save template defaults.");
    } finally {
      setSaving(false);
    }
  }

  if (editableTemplates.length === 0) {
    return (
      <div className="panel-empty panel-empty--compact">
        <h3>No hardware templates</h3>
        <p>
          Template defaults will appear here once the registry is available.
        </p>
      </div>
    );
  }

  return (
    <div className="templates-tab">
      {selectedTemplate?.configSchema ? (
        <form className="detail-card" onSubmit={handleSubmit}>
          <p className="inspector-label">Template Defaults</p>
          <h3>{selectedTemplate.name}</h3>
          <label className="field">
            <span className="field-label">Role Icon</span>
            <select
              className="field-input"
              aria-label="Role Icon"
              value={deviceRoleIcon}
              onChange={(event) =>
                setDeviceRoleIcon(event.target.value as DeviceRoleIcon)
              }
              disabled={saving}
            >
              {roleIconOptions.map((role) => (
                <option key={role} value={role}>
                  {role[0].toUpperCase() + role.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">vCPU</span>
            <input
              className="field-input"
              aria-label="vCPU"
              type="number"
              min={selectedTemplate.configSchema.vcpu.min}
              max={selectedTemplate.configSchema.vcpu.max}
              step={1}
              value={vcpu}
              onChange={(event) => setVcpu(event.target.value)}
              disabled={saving}
            />
            <span className="field-hint">
              Allowed: {selectedTemplate.configSchema.vcpu.min}-
              {selectedTemplate.configSchema.vcpu.max}
            </span>
          </label>
          <label className="field">
            <span className="field-label">RAM (MB)</span>
            <input
              className="field-input"
              aria-label="RAM (MB)"
              type="number"
              min={selectedTemplate.configSchema.ramMb.min}
              max={selectedTemplate.configSchema.ramMb.max}
              step={1}
              value={ramMb}
              onChange={(event) => setRamMb(event.target.value)}
              disabled={saving}
            />
            <span className="field-hint">
              Allowed: {selectedTemplate.configSchema.ramMb.min}-
              {selectedTemplate.configSchema.ramMb.max}
            </span>
          </label>
          <label className="field">
            <span className="field-label">Interfaces</span>
            <input
              className="field-input"
              aria-label="Interfaces"
              type="number"
              min={selectedTemplate.configSchema.interfaceCount.min}
              max={selectedTemplate.configSchema.interfaceCount.max}
              step={1}
              value={interfaceCount}
              onChange={(event) => setInterfaceCount(event.target.value)}
              disabled={saving}
            />
            <span className="field-hint">
              Allowed: {selectedTemplate.configSchema.interfaceCount.min}-
              {selectedTemplate.configSchema.interfaceCount.max}
            </span>
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saving || !onSaveTemplate}
          >
            Save Defaults
          </button>
        </form>
      ) : null}

      <ul
        className="entity-list entity-list--dense"
        aria-label="Hardware Templates"
      >
        {editableTemplates.map((template) => (
          <li key={template.id} className="entity-list-item">
            <button
              type="button"
              className={`list-card template-list-card${
                selectedTemplate?.id === template.id ? " is-selected" : ""
              }`}
              onClick={() => setSelectedTemplateId(template.id)}
              aria-label={`Select ${template.name}`}
            >
              <span className="resource-card-copy">
                <span className="resource-card-label">
                  {template.vendor ?? runtimeLabel(template.runtime)}
                </span>
                <strong className="resource-card-title">{template.name}</strong>
                <span className="resource-card-meta">
                  {runtimeLabel(template.runtime)} •{" "}
                  {template.configSchema?.vcpu.default} vCPU •{" "}
                  {template.configSchema?.ramMb.default} MB RAM •{" "}
                  {interfaceCountLabel(
                    template.configSchema?.interfaceCount.default ?? 0,
                  )}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
