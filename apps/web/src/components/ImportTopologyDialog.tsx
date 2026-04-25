import { useMemo, useState } from "react";
import type { ImportCommitRequest, ImportPreview } from "@networkchum/shared";

type CatalogOption = {
  id: string;
  name: string;
  source: string;
  runtime?: string;
};

type ImageOption = {
  id: string;
  name: string;
  templateId: string | null;
  source: string;
  catalogState: string;
};

type ImportTopologyDialogProps = {
  open: boolean;
  catalog: CatalogOption[];
  images: ImageOption[];
  onClose: () => void;
  onPreview: (file: File) => Promise<ImportPreview>;
  onCommit: (draftId: string, input: ImportCommitRequest) => Promise<void>;
};

type MappingDraft = Record<string, { templateId: string; imageId: string }>;

export function ImportTopologyDialog({
  open,
  catalog,
  images,
  onClose,
  onPreview,
  onCommit,
}: ImportTopologyDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mappings, setMappings] = useState<MappingDraft>({});
  const [excludedNodeIds, setExcludedNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const includedNodes = useMemo(() => {
    if (!preview) return [];
    return preview.nodes.filter((node) => !excludedNodeIds.has(node.foreignId));
  }, [excludedNodeIds, preview]);

  const unresolvedKeys = useMemo(() => {
    if (!preview) return [];
    return [
      ...new Set(
        includedNodes
          .filter((node) => node.status === "unresolved")
          .map((node) => node.templateKey),
      ),
    ];
  }, [includedNodes, preview]);

  const canCommit =
    preview &&
    includedNodes.length > 0 &&
    unresolvedKeys.every((key) => Boolean(mappings[key]?.templateId)) &&
    !busy;

  if (!open) {
    return null;
  }

  async function handlePreview() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const nextPreview = await onPreview(file);
      setPreview(nextPreview);
      setExcludedNodeIds(new Set());
      const nextMappings: MappingDraft = {};
      for (const node of nextPreview.nodes) {
        if (node.status === "matched" && node.matchedTemplateId) {
          nextMappings[node.templateKey] = {
            templateId: node.matchedTemplateId,
            imageId: node.matchedImageId ?? "",
          };
        }
      }
      setMappings(nextMappings);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Import preview failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!preview || !canCommit) return;
    setBusy(true);
    setError(null);
    try {
      await onCommit(preview.draftId, {
        name: preview.labName,
        mappings: [
          ...new Set(includedNodes.map((node) => node.templateKey)),
        ].flatMap((templateKey) => {
          const mapping = mappings[templateKey];
          return mapping?.templateId
            ? [
                {
                  templateKey,
                  templateId: mapping.templateId,
                  imageId: mapping.imageId || null,
                },
              ]
            : [];
        }),
        excludedNodeIds: Array.from(excludedNodeIds),
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Import commit failed",
      );
    } finally {
      setBusy(false);
    }
  }

  function templateOptionsFor(node: ImportPreview["nodes"][number]) {
    const candidateIds = new Set(
      node.candidates.map((candidate) => candidate.templateId),
    );
    const ordered = [
      ...node.candidates.map((candidate) => ({
        id: candidate.templateId,
        name: candidate.label,
      })),
      ...catalog
        .filter((entry) => !candidateIds.has(entry.id))
        .map((entry) => ({ id: entry.id, name: entry.name })),
    ];
    return ordered;
  }

  return (
    <div role="dialog" aria-label="Import Topology" className="dialog-overlay">
      <div className="dialog import-dialog">
        <div className="dialog-header">
          <div>
            <p className="panel-eyebrow">Workspace</p>
            <h2>Import Lab</h2>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <label className="field">
          <span className="field-label">Topology File</span>
          <input
            className="field-input"
            type="file"
            aria-label="Topology File"
            accept=".unl,.gns3,.gns3project,.gns3p,.zip"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setMappings({});
              setExcludedNodeIds(new Set());
            }}
          />
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!file || busy}
            onClick={() => void handlePreview()}
          >
            Preview Import
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        {preview ? (
          <div className="import-preview">
            <div className="import-summary">
              <strong>{preview.labName}</strong>
              <span>{preview.source.format}</span>
              <span>{includedNodes.length} nodes</span>
              <span>{preview.summary.links} links</span>
              {excludedNodeIds.size > 0 ? (
                <span>{excludedNodeIds.size} removed</span>
              ) : null}
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
              aria-label="Import Nodes"
            >
              {includedNodes.map((node) => {
                const mapping = mappings[node.templateKey];
                const selectedTemplateId =
                  mapping?.templateId ?? node.matchedTemplateId ?? "";
                const availableImages = images.filter(
                  (image) =>
                    image.catalogState === "active" &&
                    image.templateId === selectedTemplateId,
                );
                return (
                  <div className="import-row" role="row" key={node.foreignId}>
                    <span>{node.name}</span>
                    <span>{node.requestedTemplate ?? "unknown"}</span>
                    {node.status === "matched" ? (
                      <span>
                        {catalog.find(
                          (entry) => entry.id === node.matchedTemplateId,
                        )?.name ?? node.matchedTemplateId}
                      </span>
                    ) : (
                      <label className="compact-field">
                        <span className="sr-only">{`Substitute for ${node.name}`}</span>
                        <select
                          className="field-input"
                          aria-label={`Substitute for ${node.name}`}
                          value={selectedTemplateId}
                          onChange={(event) =>
                            setMappings((current) => ({
                              ...current,
                              [node.templateKey]: {
                                templateId: event.target.value,
                                imageId: "",
                              },
                            }))
                          }
                        >
                          <option value="">Choose template</option>
                          {templateOptionsFor(node).map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="compact-field">
                      <span className="sr-only">{`Image for ${node.name}`}</span>
                      <select
                        className="field-input"
                        aria-label={`Image for ${node.name}`}
                        value={mapping?.imageId ?? node.matchedImageId ?? ""}
                        disabled={!selectedTemplateId}
                        onChange={(event) =>
                          setMappings((current) => ({
                            ...current,
                            [node.templateKey]: {
                              templateId: selectedTemplateId,
                              imageId: event.target.value,
                            },
                          }))
                        }
                      >
                        <option value="">Default image</option>
                        {availableImages.map((image) => (
                          <option key={image.id} value={image.id}>
                            {image.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary import-remove-button"
                      aria-label={`Remove ${node.name}`}
                      onClick={() =>
                        setExcludedNodeIds((current) => {
                          const next = new Set(current);
                          next.add(node.foreignId);
                          return next;
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="dialog-actions import-commit-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canCommit}
                onClick={() => void handleCommit()}
              >
                Create Lab
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
