import { useRef, useState } from "react";

import { suggestTemplateId } from "@networkchum/shared";

import type {
  ImageRepoSummary,
  RepoListingSummary,
  RepoPullSummary,
} from "../api/client.js";

import { ConfirmDialog } from "./ConfirmDialog.js";
import { ContextMenu } from "./ContextMenu.js";
import { ImageRepoBrowser } from "./ImageRepoBrowser.js";

type ImageSummary = {
  id: string;
  name: string;
  templateId: string | null;
  suggestedTemplateId?: string | null;
  suggestedRamMb?: number | null;
  suggestedVcpu?: number | null;
  suggestedSource?: string | null;
  source: string;
  catalogState: string;
};

type ImageLibraryProps = {
  images: ImageSummary[];
  templates?: Array<{ id: string; name: string }>;
  onUpload: (file: File, templateId: string) => Promise<void>;
  onBind: (imageId: string, templateId: string) => void | Promise<void>;
  onUnbind: (imageId: string) => void | Promise<void>;
  onRemoveFromCatalog: (imageId: string) => void | Promise<void>;
  onDeleteImageFile: (imageId: string) => void | Promise<void>;
  onSelectImage?: (imageId: string) => void;
  repos?: ImageRepoSummary[];
  onAddRepo?: (input: {
    name: string;
    kind: "local" | "url";
    path?: string;
    url?: string;
  }) => Promise<ImageRepoSummary>;
  onRemoveRepo?: (repoId: string) => Promise<void>;
  onLoadRepoEntries?: (
    repoId: string,
    dirPath: string,
  ) => Promise<RepoListingSummary>;
  onStartRepoPull?: (
    repoId: string,
    entryPath: string,
    templateId?: string,
  ) => Promise<RepoPullSummary>;
  onLoadRepoPulls?: (repoId: string) => Promise<RepoPullSummary[]>;
  onPullComplete?: () => void | Promise<void>;
  onClassifyWithAi?: (imageId: string) => void | Promise<void>;
};

type UploadDialogState =
  | { open: false }
  | {
      open: true;
      file: File | null;
      templateId: string;
      uploading: boolean;
      error: string | null;
    };

type BindDialogState = {
  imageId: string;
  imageName: string;
  templateId: string;
  restore: boolean;
  busy: boolean;
  error: string | null;
};

type ConfirmState =
  | { kind: "remove"; imageId: string; imageName: string }
  | { kind: "delete"; imageId: string; imageName: string };

export function ImageLibrary({
  images,
  templates = [],
  onUpload,
  onBind,
  onUnbind,
  onRemoveFromCatalog,
  onDeleteImageFile,
  onSelectImage,
  repos,
  onAddRepo,
  onRemoveRepo,
  onLoadRepoEntries,
  onStartRepoPull,
  onLoadRepoPulls,
  onPullComplete,
  onClassifyWithAi,
}: ImageLibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<UploadDialogState>({ open: false });
  const [bindDialog, setBindDialog] = useState<BindDialogState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [classifyingId, setClassifyingId] = useState<string | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    imageId: string;
    x: number;
    y: number;
  } | null>(null);

  function defaultTemplateId(fileName: string): string {
    const suggested = suggestTemplateId(fileName);
    if (suggested && templates.some((t) => t.id === suggested)) {
      return suggested;
    }
    return templates[0]?.id ?? "";
  }

  async function handleClassify(imageId: string) {
    if (!onClassifyWithAi) {
      return;
    }
    setClassifyError(null);
    setClassifyingId(imageId);
    try {
      await onClassifyWithAi(imageId);
    } catch (error) {
      setClassifyError(
        error instanceof Error ? error.message : "AI classification failed",
      );
    } finally {
      setClassifyingId(null);
    }
  }

  function openDialog() {
    setDialog({
      open: true,
      file: null,
      templateId: templates[0]?.id ?? "",
      uploading: false,
      error: null,
    });
  }

  function closeDialog() {
    setDialog({ open: false });
  }

  function openBindDialog(image: ImageSummary, restore: boolean) {
    setBindDialog({
      imageId: image.id,
      imageName: image.name,
      templateId:
        image.suggestedTemplateId &&
        templates.some((t) => t.id === image.suggestedTemplateId)
          ? image.suggestedTemplateId
          : (templates[0]?.id ?? ""),
      restore,
      busy: false,
      error: null,
    });
  }

  async function handleBindConfirm() {
    if (!bindDialog || bindDialog.busy) {
      return;
    }
    setBindDialog({ ...bindDialog, busy: true, error: null });
    try {
      await onBind(bindDialog.imageId, bindDialog.templateId);
      setBindDialog(null);
    } catch (err) {
      setBindDialog({
        ...bindDialog,
        busy: false,
        error: err instanceof Error ? err.message : "Bind failed",
      });
    }
  }

  async function handleSubmit() {
    if (!dialog.open || !dialog.file || !dialog.templateId || dialog.uploading)
      return;
    setDialog({ ...dialog, uploading: true, error: null });
    try {
      await onUpload(dialog.file, dialog.templateId);
      closeDialog();
    } catch (err) {
      setDialog({
        ...dialog,
        uploading: false,
        error: err instanceof Error ? err.message : "Upload failed",
      });
    }
  }

  function pickFile(file: File) {
    if (dialog.open) {
      setDialog({
        ...dialog,
        file,
        templateId: defaultTemplateId(file.name),
      });
    }
  }

  const suggestedForWizard =
    dialog.open && dialog.file ? suggestTemplateId(dialog.file.name) : null;
  const suggestionMatchesTemplate =
    suggestedForWizard !== null &&
    templates.some((t) => t.id === suggestedForWizard);

  const repoBrowserEnabled =
    repos != null &&
    onAddRepo != null &&
    onRemoveRepo != null &&
    onLoadRepoEntries != null &&
    onStartRepoPull != null &&
    onLoadRepoPulls != null &&
    onPullComplete != null;

  return (
    <section className="panel-section">
      <div className="panel-section-header">
        <p className="panel-eyebrow">Catalog</p>
        <h2>Image Library</h2>
        <p className="panel-description">
          Upload disk images, bind them to templates, and keep the catalog
          clean.
        </p>
      </div>
      <div className="panel-actions">
        <button type="button" className="btn btn-primary" onClick={openDialog}>
          Upload Image
        </button>
      </div>

      {repoBrowserEnabled ? (
        <ImageRepoBrowser
          repos={repos ?? []}
          templates={templates}
          onAddRepo={onAddRepo!}
          onRemoveRepo={onRemoveRepo!}
          onLoadRepoEntries={onLoadRepoEntries!}
          onStartRepoPull={onStartRepoPull!}
          onLoadRepoPulls={onLoadRepoPulls!}
          onPullComplete={onPullComplete!}
        />
      ) : null}

      {dialog.open && (
        <div
          role="dialog"
          aria-label="Upload Image"
          className="dialog-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeDialog();
          }}
        >
          <div className="dialog-card dialog-card--wide">
            <div className="dialog-header">
              <p className="panel-eyebrow">Add device image</p>
              <h2>Upload Image</h2>
            </div>

            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) =>
                e.key === "Enter" && fileInputRef.current?.click()
              }
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDragLeave={() => undefined}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) pickFile(file);
              }}
              className="upload-dropzone"
            >
              {dialog.file ? (
                <span>
                  {dialog.file.name} (
                  {(dialog.file.size / 1024 / 1024).toFixed(1)} MB)
                </span>
              ) : (
                <span>Click to browse or drop a .qcow2 file here</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".qcow2,.iso"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) pickFile(file);
                e.currentTarget.value = "";
              }}
            />

            {templates.length > 0 ? (
              <div className="field">
                {dialog.file ? (
                  <span className="field-label">This looks like…</span>
                ) : (
                  <span className="field-label">Device type</span>
                )}
                <select
                  value={dialog.templateId}
                  onChange={(e) => {
                    if (dialog.open)
                      setDialog({ ...dialog, templateId: e.target.value });
                  }}
                  className="field-input"
                  aria-label="Device type"
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <p className="panel-description">
                  {dialog.file
                    ? suggestionMatchesTemplate
                      ? "Matched from the file name — correct it if needed."
                      : "Pick the device this image boots."
                    : "Binding makes the device appear in the device catalog."}
                </p>
              </div>
            ) : null}

            {dialog.error && <p className="form-error">{dialog.error}</p>}

            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                onClick={closeDialog}
                disabled={dialog.uploading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSubmit()}
                disabled={
                  !dialog.file || !dialog.templateId || dialog.uploading
                }
              >
                {dialog.uploading ? "Uploading…" : "Upload & bind"}
              </button>
            </div>
          </div>
        </div>
      )}

      {bindDialog ? (
        <div
          role="dialog"
          aria-label={bindDialog.restore ? "Restore Image" : "Bind Image"}
          className="dialog-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBindDialog(null);
          }}
        >
          <div className="dialog-card dialog-card--compact">
            <div className="dialog-header">
              <p className="panel-eyebrow">Catalog</p>
              <h2>{bindDialog.restore ? "Restore Image" : "Bind Image"}</h2>
            </div>
            <p>
              Bind <strong>{bindDialog.imageName}</strong> to a device template.
              {bindDialog.restore
                ? " Binding also returns the image to the device catalog."
                : ""}
            </p>
            <label className="field">
              <span className="field-label">Device template</span>
              <select
                value={bindDialog.templateId}
                onChange={(e) =>
                  setBindDialog({ ...bindDialog, templateId: e.target.value })
                }
                className="field-input"
                aria-label="Device template"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {bindDialog.error && (
              <p className="form-error">{bindDialog.error}</p>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setBindDialog(null)}
                disabled={bindDialog.busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleBindConfirm()}
                disabled={!bindDialog.templateId || bindDialog.busy}
              >
                {bindDialog.restore ? "Restore" : "Bind"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmState?.kind === "remove"}
        title="Remove from catalog"
        body={
          confirmState?.kind === "remove"
            ? `${confirmState.imageName} will be hidden from the device catalog. The file stays on disk.`
            : ""
        }
        onConfirm={() => {
          if (confirmState?.kind === "remove") {
            void onRemoveFromCatalog(confirmState.imageId);
          }
          setConfirmState(null);
        }}
        onCancel={() => setConfirmState(null)}
      />
      <ConfirmDialog
        open={confirmState?.kind === "delete"}
        title="Delete file from disk"
        body={
          confirmState?.kind === "delete"
            ? `${confirmState.imageName} will be permanently deleted from disk. This cannot be undone.`
            : ""
        }
        onConfirm={() => {
          if (confirmState?.kind === "delete") {
            void onDeleteImageFile(confirmState.imageId);
          }
          setConfirmState(null);
        }}
        onCancel={() => setConfirmState(null)}
      />

      {images.length === 0 ? (
        <div className="panel-empty panel-empty--compact">
          <h3>No images uploaded</h3>
          <p>
            Drop in a QCOW2 or ISO image to start building reusable device
            templates.
          </p>
        </div>
      ) : null}
      {classifyError ? <p className="form-error">{classifyError}</p> : null}
      {classifyingId ? (
        <p className="resource-card-meta">
          {images.find((image) => image.id === classifyingId)?.name ??
            classifyingId}
          : AI is identifying this image…
        </p>
      ) : null}
      <ul
        className="entity-list entity-list--stack"
        aria-label="Uploaded images"
      >
        {images.map((image) => {
          const isActive = image.catalogState !== "removed";
          const isBound = Boolean(image.templateId);
          return (
            <li key={image.id} className="entity-list-item">
              <div className="resource-card resource-card--stack">
                <div className="resource-card-copy">
                  <div className="list-card-row">
                    <button
                      type="button"
                      className="resource-card-button"
                      onClick={() => onSelectImage?.(image.id)}
                    >
                      {image.name}
                    </button>
                    <span
                      className={`list-item-badge${isActive ? " is-accent" : ""}`}
                    >
                      {image.catalogState === "removed"
                        ? "removed"
                        : isBound
                          ? "in use"
                          : "unbound"}
                    </span>
                  </div>
                  <p className="resource-card-meta">
                    {image.source}
                    {image.templateId
                      ? ` • bound to ${image.templateId}${image.suggestedSource === "ai" ? " (AI)" : ""}`
                      : ""}
                    {image.suggestedSource === "ai" &&
                    image.suggestedRamMb &&
                    image.suggestedVcpu
                      ? ` • AI: ${image.suggestedRamMb} MB / ${image.suggestedVcpu} vCPU`
                      : ""}
                  </p>
                </div>
                <div className="resource-card-controls">
                  {isActive && isBound ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void onUnbind(image.id)}
                    >
                      Unbind
                    </button>
                  ) : null}
                  {isActive && !isBound && templates.length ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => openBindDialog(image, false)}
                    >
                      Bind…
                    </button>
                  ) : null}
                  {!isActive && templates.length ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => openBindDialog(image, true)}
                    >
                      Restore…
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-sm btn-dots"
                    aria-label={`More actions for ${image.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenu({
                        imageId: image.id,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                  >
                    •••
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {menu ? (
        <ContextMenu
          open
          x={menu.x}
          y={menu.y}
          items={[
            ...(isActiveImage(images, menu.imageId)
              ? [
                  {
                    label: "Bind to template…",
                    onSelect: () => {
                      const image = images.find((i) => i.id === menu.imageId);
                      if (image) openBindDialog(image, false);
                    },
                  },
                ]
              : []),
            ...(isActiveImage(images, menu.imageId) && onClassifyWithAi
              ? [
                  {
                    label: "Ask AI to identify…",
                    onSelect: () => {
                      setMenu(null);
                      void handleClassify(menu.imageId);
                    },
                  },
                ]
              : []),
            ...(isActiveImage(images, menu.imageId)
              ? [
                  {
                    label: "Remove from catalog…",
                    danger: true,
                    onSelect: () => {
                      const image = images.find((i) => i.id === menu.imageId);
                      if (image) {
                        setConfirmState({
                          kind: "remove",
                          imageId: image.id,
                          imageName: image.name,
                        });
                      }
                    },
                  },
                ]
              : []),
            {
              label: "Delete file from disk…",
              danger: true,
              onSelect: () => {
                const image = images.find((i) => i.id === menu.imageId);
                if (image) {
                  setConfirmState({
                    kind: "delete",
                    imageId: image.id,
                    imageName: image.name,
                  });
                }
              },
            },
          ]}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </section>
  );
}

function isActiveImage(images: ImageSummary[], imageId: string): boolean {
  const image = images.find((i) => i.id === imageId);
  return image ? image.catalogState !== "removed" : false;
}
