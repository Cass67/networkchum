import { useEffect, useState } from "react";

import type { ContainerEngine } from "../api/client.js";

export type ContainerActionTarget = {
  imageRef: string;
  registry: string;
  engine: ContainerEngine | null;
};

function inferDisplayName(imageRef: string): string {
  const repository = imageRef.split(":")[0] ?? imageRef;
  const baseName = repository.split("/").filter(Boolean).at(-1) ?? repository;
  const tag = imageRef.includes(":") ? imageRef.split(":").at(-1) : null;
  const title = baseName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return tag ? `${title} ${tag}` : title;
}

function guessShell(imageRef: string): string {
  const lower = imageRef.toLowerCase();
  return /ubuntu|debian|oraclelinux|centos|rockylinux|fedora/.test(lower)
    ? "bash"
    : "sh";
}

export function ContainerImageActionDialog({
  open,
  target,
  activeLabId,
  saving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  target: ContainerActionTarget | null;
  activeLabId?: string | null;
  saving?: boolean;
  onClose: () => void;
  onSubmit: (input: {
    action: "save-template" | "create-node";
    displayName: string;
    imageRef: string;
    registry: string;
    shell: string;
  }) => Promise<void> | void;
}) {
  const [action, setAction] = useState<"save-template" | "create-node">(
    "save-template",
  );
  const [displayName, setDisplayName] = useState("");
  const [shell, setShell] = useState("sh");

  useEffect(() => {
    if (!open || !target) {
      return;
    }

    setAction("save-template");
    setDisplayName(inferDisplayName(target.imageRef));
    setShell(guessShell(target.imageRef));
  }, [open, target]);

  if (!open || !target) {
    return null;
  }

  const createBlocked = action === "create-node" && !activeLabId;

  return (
    <div
      role="dialog"
      aria-label="Use Container Image"
      className="dialog-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onClose();
        }
      }}
    >
      <div className="dialog-card dialog-card--wide">
        <div className="dialog-header">
          <p className="panel-eyebrow">Containers</p>
          <h2>Use Container Image</h2>
          <p>{target.imageRef}</p>
        </div>

        <label className="field">
          <span className="field-label">Display Name</span>
          <input
            className="field-input"
            aria-label="Container Display Name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Shell</span>
          <input
            className="field-input"
            aria-label="Container Shell"
            value={shell}
            onChange={(event) => setShell(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Action</span>
          <select
            className="field-input"
            aria-label="Container Action"
            value={action}
            onChange={(event) =>
              setAction(event.target.value as "save-template" | "create-node")
            }
          >
            <option value="save-template">Save as reusable template</option>
            <option value="create-node">
              Create one-off node in current lab
            </option>
          </select>
        </label>

        <div className="panel-section" style={{ marginTop: 12 }}>
          <p className="resource-card-meta">
            Registry: {target.registry} • Runtime: {target.engine ?? "unknown"}
          </p>
          {createBlocked ? (
            <p className="form-error">
              Select or create a lab before creating a one-off container node.
            </p>
          ) : null}
        </div>

        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              void onSubmit({
                action,
                displayName: displayName.trim(),
                imageRef: target.imageRef,
                registry: target.registry,
                shell: shell.trim() || "sh",
              })
            }
            disabled={saving || !displayName.trim() || createBlocked}
          >
            {saving
              ? "Working…"
              : action === "save-template"
                ? "Save Template"
                : "Create Node"}
          </button>
        </div>
      </div>
    </div>
  );
}
