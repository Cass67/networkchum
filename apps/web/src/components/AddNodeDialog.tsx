import { useMemo, useState } from "react";

import { DeviceIcon, getDeviceIconKind } from "../icons/deviceIcons.js";
import {
  getDeviceRoleIcon,
  type DeviceRoleIcon,
} from "../icons/deviceRoleIcons.js";

type CloudRole = "management" | "private-circuit" | "isp-carrier";

type CloudManagementCapabilities = {
  platform: string;
  managementCloudMode?: string;
};

type TemplateEntry = {
  id: string;
  name: string;
  source: string;
  runtime?: string;
  vendor?: string;
  deviceRoleIcon?: DeviceRoleIcon;
  imageId?: string | null;
  imageName?: string | null;
  configSchema?: {
    interfaceCount: { default: number; min: number; max: number };
  };
};

type ExistingNode = {
  id: string;
  name: string;
  position?: { x: number; y: number };
};

type AddNodeDialogProps = {
  templates: TemplateEntry[];
  existingNodes: ExistingNode[];
  cloudManagementCapabilities?: CloudManagementCapabilities | null;
  onSubmit: (input: {
    templateId: string;
    name: string;
    position: { x: number; y: number };
    imageId?: string;
    interfaceCount?: number;
    cloudRole?: CloudRole;
    bridgeGroup?: string | null;
  }) => Promise<void>;
  hostInterfaces: string[];
  onCancel: () => void;
};

type DeviceGroup = {
  vendor: string | null;
  entries: TemplateEntry[];
};

function groupByVendor(templates: TemplateEntry[]): DeviceGroup[] {
  const groups: DeviceGroup[] = [];
  const byVendor = new Map<string, DeviceGroup>();

  for (const template of templates) {
    const key = template.vendor ?? null;
    let group = byVendor.get(key ?? "");
    if (!group) {
      group = { vendor: key, entries: [] };
      byVendor.set(key ?? "", group);
      groups.push(group);
    }
    if (group.entries.some((entry) => entry.id === template.id)) {
      continue;
    }
    group.entries.push(template);
  }

  return groups;
}

function runtimeLabel(template: TemplateEntry): string | null {
  return template.runtime === "qemu"
    ? "VM"
    : template.runtime === "container"
      ? "Container"
      : template.runtime === "cloud"
        ? "Cloud"
        : null;
}

function computeNextPosition(existingNodes: ExistingNode[]): {
  x: number;
  y: number;
} {
  const gridSize = 120;
  const padding = 40;

  if (existingNodes.length === 0) {
    return { x: padding, y: padding };
  }

  const occupied = new Set(
    existingNodes
      .filter((n) => n.position)
      .map(
        (n) =>
          `${Math.round((n.position!.x - padding) / gridSize)},${Math.round((n.position!.y - padding) / gridSize)}`,
      ),
  );

  for (let row = 0; row < 20; row++) {
    for (let col = 0; col < 10; col++) {
      if (!occupied.has(`${col},${row}`)) {
        return { x: padding + col * gridSize, y: padding + row * gridSize };
      }
    }
  }

  return { x: padding + existingNodes.length * gridSize, y: padding };
}

function defaultNameFor(
  template: TemplateEntry,
  existingNodes: ExistingNode[],
) {
  const base =
    template.name ||
    template.id
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .replace(/ /g, "-");
  return `${base}-${existingNodes.length + 1}`;
}

export function AddNodeDialog({
  templates,
  existingNodes,
  hostInterfaces: _hostInterfaces,
  cloudManagementCapabilities,
  onSubmit,
  onCancel,
}: AddNodeDialogProps) {
  const [search, setSearch] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [selectedImageId, setSelectedImageId] = useState<string | undefined>(
    undefined,
  );
  const [name, setName] = useState(() =>
    templates[0] ? defaultNameFor(templates[0], existingNodes) : "node",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deviceGroups = useMemo(() => groupByVendor(templates), [templates]);
  const hasVendorGroups = deviceGroups.some((group) => group.vendor !== null);

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return deviceGroups;
    }
    return deviceGroups
      .map((group) => ({
        ...group,
        entries: group.entries.filter((entry) =>
          `${entry.name} ${entry.vendor ?? ""}`.toLowerCase().includes(query),
        ),
      }))
      .filter((group) => group.entries.length > 0);
  }, [deviceGroups, search]);

  const selectedTemplate = templates.find(
    (template) => template.id === templateId,
  );
  const imageOptions = useMemo(
    () =>
      templates
        .filter((template) => template.id === templateId && template.imageId)
        .map((template) => ({
          id: template.imageId!,
          name: template.imageName ?? template.imageId!,
        }))
        .filter(
          (option, index, options) =>
            options.findIndex((other) => other.id === option.id) === index,
        ),
    [templates, templateId],
  );

  const interfaceRange = selectedTemplate?.configSchema?.interfaceCount;
  const showInterfaceCount =
    interfaceRange !== undefined && interfaceRange.min !== interfaceRange.max;
  const [interfaceCount, setInterfaceCount] = useState(
    templates[0]?.configSchema?.interfaceCount.default,
  );
  const showCloudBridgeSettings = selectedTemplate?.runtime === "cloud";
  const [cloudRole, setCloudRole] = useState<CloudRole>("management");
  const [bridgeGroup, setBridgeGroup] = useState("management");
  const showMacOsManagementSubnetGuidance =
    showCloudBridgeSettings &&
    cloudRole === "management" &&
    cloudManagementCapabilities?.platform === "macos";

  function handleTemplateChange(newTemplateId: string) {
    setTemplateId(newTemplateId);
    const template = templates.find((t) => t.id === newTemplateId);
    if (template) {
      setInterfaceCount(template.configSchema?.interfaceCount.default);
      setCloudRole("management");
      setBridgeGroup("management");
      const firstImage = templates.find(
        (t) => t.id === newTemplateId && t.imageId,
      );
      setSelectedImageId(firstImage?.imageId ?? undefined);
      setName(defaultNameFor(template, existingNodes));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const position = computeNextPosition(existingNodes);
      await onSubmit({
        templateId,
        name,
        position,
        imageId:
          imageOptions.length > 1
            ? (selectedImageId ?? imageOptions[0]?.id)
            : undefined,
        interfaceCount: showInterfaceCount ? interfaceCount : undefined,
        cloudRole: showCloudBridgeSettings ? cloudRole : undefined,
        bridgeGroup: showCloudBridgeSettings
          ? cloudRole === "management"
            ? bridgeGroup.trim() || "management"
            : bridgeGroup.trim() || null
          : undefined,
      });
    } catch {
      setError("Failed to add node");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dialog-overlay" data-testid="add-node-dialog-overlay">
      <div className="dialog-card" role="dialog" aria-label="Add Node">
        <div className="dialog-header">
          <p className="panel-eyebrow">Topology</p>
          <h2>Add Node</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <span className="field-label">Device</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices…"
              className="field-input"
              data-testid="device-search"
              aria-label="Search devices"
            />
            <ul className="device-option-list" aria-label="Device templates">
              {filteredGroups.map((group) => [
                hasVendorGroups ? (
                  <li
                    key={`group-${group.vendor ?? "other"}`}
                    className="device-group-label"
                  >
                    {group.vendor ?? "Other"}
                  </li>
                ) : null,
                ...group.entries.map((entry) => {
                  const runtimeKind = getDeviceIconKind(entry.runtime);
                  const isSelected = entry.id === templateId;
                  const chosenImageId =
                    imageOptions.length > 1 && isSelected
                      ? (selectedImageId ?? imageOptions[0]?.id)
                      : undefined;
                  return (
                    <li
                      key={`${entry.id}:${entry.imageId ?? "builtin"}`}
                      className={`device-option${isSelected ? " is-selected" : ""}`}
                    >
                      <button
                        type="button"
                        className="device-option-main"
                        onClick={() => handleTemplateChange(entry.id)}
                        data-testid={`device-option-${entry.id}`}
                      >
                        <span className="device-option-icon">
                          {getDeviceRoleIcon(entry.deviceRoleIcon) ??
                            (entry.runtime ? (
                              <DeviceIcon
                                kind={runtimeKind}
                                testId={`device-icon-${runtimeKind}`}
                              />
                            ) : null)}
                        </span>
                        <span className="device-option-copy">
                          <span className="device-option-name">
                            {entry.name}
                          </span>
                          <span className="device-option-meta">
                            {[entry.vendor, runtimeLabel(entry)]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      </button>
                      {imageOptions.length > 1 && isSelected ? (
                        <select
                          className="field-input device-option-images"
                          aria-label={`Image for ${entry.name}`}
                          value={chosenImageId ?? ""}
                          onChange={(e) => setSelectedImageId(e.target.value)}
                        >
                          {imageOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </li>
                  );
                }),
              ])}
              {filteredGroups.length === 0 ? (
                <li className="device-option-empty">No matching devices</li>
              ) : null}
            </ul>
          </div>
          <div className="field">
            <label>
              <span className="field-label">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field-input"
                data-testid="node-name-input"
              />
            </label>
          </div>
          {showInterfaceCount && interfaceRange ? (
            <div className="field">
              <label>
                <span className="field-label">Interfaces</span>
                <input
                  type="number"
                  min={interfaceRange.min}
                  max={interfaceRange.max}
                  value={interfaceCount ?? interfaceRange.default}
                  onChange={(e) => setInterfaceCount(Number(e.target.value))}
                  className="field-input"
                  data-testid="interface-count-input"
                />
              </label>
            </div>
          ) : null}
          {showCloudBridgeSettings ? (
            <div className="field">
              <label>
                <span className="field-label">Cloud Role</span>
                <select
                  value={cloudRole}
                  onChange={(e) => {
                    const nextRole = e.target.value as CloudRole;
                    setCloudRole(nextRole);
                    if (nextRole === "management") {
                      setBridgeGroup(
                        (current) => current.trim() || "management",
                      );
                      return;
                    }

                    setBridgeGroup((current) =>
                      current === "management" ? "" : current,
                    );
                  }}
                  className="field-input"
                  aria-label="Cloud Role"
                >
                  <option value="management">Management</option>
                  <option value="private-circuit">Private Circuit</option>
                  <option value="isp-carrier">ISP Carrier</option>
                </select>
              </label>
            </div>
          ) : null}
          {showCloudBridgeSettings ? (
            <div className="field">
              <label>
                <span className="field-label">Bridge Group</span>
                <input
                  type="text"
                  value={bridgeGroup}
                  onChange={(e) => setBridgeGroup(e.target.value)}
                  className="field-input"
                  aria-label="Bridge Group"
                />
              </label>
              <p className="panel-description">
                {cloudRole === "management"
                  ? "Management clouds default to the shared `management` bridge group."
                  : "Use the same bridge group on other clouds when they should share the same managed bridge."}
              </p>
              {showMacOsManagementSubnetGuidance ? (
                <p className="panel-description">
                  macOS management subnet: 172.31.255.0/24 (host 172.31.255.1).
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                submitting ||
                !templateId ||
                !name.trim() ||
                (showCloudBridgeSettings &&
                  cloudRole !== "management" &&
                  !bridgeGroup.trim())
              }
              data-testid="add-node-submit"
            >
              {submitting ? "Adding..." : "Add Node"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export { computeNextPosition };
