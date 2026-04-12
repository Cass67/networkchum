import { useRef, useState } from "react";

type ImageSummary = {
  id: string;
  name: string;
  templateId: string | null;
  suggestedTemplateId?: string | null;
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

export function ImageLibrary({
  images,
  templates = [],
  onUpload,
  onBind,
  onUnbind,
  onRemoveFromCatalog,
  onDeleteImageFile,
  onSelectImage,
}: ImageLibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<UploadDialogState>({ open: false });
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<
    Record<string, string>
  >({});
  const [dragOver, setDragOver] = useState(false);

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
              <p className="panel-eyebrow">Upload</p>
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
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) setDialog({ ...dialog, file });
              }}
              className={`upload-dropzone${dragOver ? " is-dragover" : ""}`}
            >
              {dialog.file ? (
                <span>
                  {dialog.file.name} (
                  {(dialog.file.size / 1024 / 1024).toFixed(1)} MB)
                </span>
              ) : (
                <span>Click to browse or drag a .qcow2 file here</span>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".qcow2,.iso"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && dialog.open) setDialog({ ...dialog, file });
                e.currentTarget.value = "";
              }}
            />

            <label className="field">
              <span className="field-label">Device type</span>
              <select
                value={dialog.templateId}
                onChange={(e) => {
                  if (dialog.open)
                    setDialog({ ...dialog, templateId: e.target.value });
                }}
                className="field-input"
              >
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

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
                {dialog.uploading ? "Uploading…" : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}

      {images.length === 0 ? (
        <div className="panel-empty panel-empty--compact">
          <h3>No images uploaded</h3>
          <p>
            Drop in a QCOW2 or ISO image to start building reusable device
            templates.
          </p>
        </div>
      ) : null}
      <ul
        className="entity-list entity-list--stack"
        aria-label="Uploaded images"
      >
        {images.map((image) => {
          const selectedTemplateId =
            selectedTemplateIds[image.id] ??
            image.suggestedTemplateId ??
            templates[0]?.id ??
            "";
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
                      className={`list-item-badge${image.catalogState === "removed" ? "" : " is-accent"}`}
                    >
                      {image.catalogState}
                    </span>
                  </div>
                  <p className="resource-card-meta">
                    {image.source}
                    {image.templateId ? ` • bound to ${image.templateId}` : ""}
                  </p>
                </div>
                <div className="resource-card-controls">
                  {templates.length ? (
                    <select
                      aria-label={`Bind template for ${image.name}`}
                      className="field-input"
                      value={selectedTemplateId}
                      onChange={(e) =>
                        setSelectedTemplateIds((cur) => ({
                          ...cur,
                          [image.id]: e.target.value,
                        }))
                      }
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {image.catalogState !== "removed" ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onBind(image.id, selectedTemplateId)}
                      disabled={!selectedTemplateId}
                    >
                      Bind Template
                    </button>
                  ) : null}
                  {image.templateId ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => onUnbind(image.id)}
                    >
                      Unbind
                    </button>
                  ) : null}
                  {image.catalogState !== "removed" ? (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => onRemoveFromCatalog(image.id)}
                    >
                      Remove
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => onDeleteImageFile(image.id)}
                  >
                    Delete File
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
