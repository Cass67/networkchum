import { useEffect, useState } from "react";

import type {
  ContainerEngine,
  ContainerSearchResultSummary,
  LocalContainerImageSummary,
} from "../api/client.js";
import {
  ContainerImageActionDialog,
  type ContainerActionTarget,
} from "./ContainerImageActionDialog.js";

type ContainersApi = {
  getContainerRuntime?: () => Promise<{
    engine: ContainerEngine | null;
    available: boolean;
    message: string | null;
  }>;
  listContainerImages?: () => Promise<{
    engine: ContainerEngine | null;
    images: LocalContainerImageSummary[];
    message: string | null;
  }>;
  searchContainerImages?: (
    registry: string,
    query: string,
  ) => Promise<ContainerSearchResultSummary[]>;
  pullContainerImage?: (
    registry: string,
    imageRef: string,
  ) => Promise<{
    engine: ContainerEngine;
    imageRef: string;
    image: LocalContainerImageSummary | null;
  }>;
  saveContainerTemplate?: (input: {
    displayName: string;
    imageRef: string;
    registry: string;
    shell?: string;
  }) => Promise<unknown>;
  createContainerNode?: (
    labId: string,
    input: {
      displayName: string;
      imageRef: string;
      registry: string;
      shell?: string;
    },
  ) => Promise<unknown>;
};

export function ContainersTab({
  api,
  activeLabId,
  onTemplateSaved,
  onNodeCreated,
}: {
  api: ContainersApi;
  activeLabId?: string | null;
  onTemplateSaved?: () => Promise<void> | void;
  onNodeCreated?: (lab: unknown) => Promise<void> | void;
}) {
  const [runtime, setRuntime] = useState<{
    engine: ContainerEngine | null;
    available: boolean;
    message: string | null;
  }>({
    engine: null,
    available: false,
    message: null,
  });
  const [localImages, setLocalImages] = useState<LocalContainerImageSummary[]>(
    [],
  );
  const [searchRegistry, setSearchRegistry] = useState("docker-hub");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    ContainerSearchResultSummary[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [selectedTarget, setSelectedTarget] =
    useState<ContainerActionTarget | null>(null);

  async function refreshLocalImages() {
    if (!api.listContainerImages) {
      return;
    }

    const response = await api.listContainerImages();
    setLocalImages(response.images);
    setRuntime((current) => ({
      engine: response.engine ?? current.engine,
      available: response.engine !== null,
      message: response.message,
    }));
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const runtimeResponse = api.getContainerRuntime
        ? await api.getContainerRuntime()
        : { engine: null, available: false, message: null };
      if (cancelled) {
        return;
      }

      setRuntime(runtimeResponse);
      if (!runtimeResponse.available || !api.listContainerImages) {
        setLocalImages([]);
        return;
      }

      const imageResponse = await api.listContainerImages();
      if (!cancelled) {
        setLocalImages(imageResponse.images);
      }
    })().catch(() => {
      if (!cancelled) {
        setRuntime({
          engine: null,
          available: false,
          message: "Failed to load container runtime details.",
        });
        setLocalImages([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [api]);

  async function handleSearch() {
    if (!api.searchContainerImages || !query.trim()) {
      return;
    }

    setBusy(true);
    try {
      const results = await api.searchContainerImages(searchRegistry, query);
      setSearchResults(results);
    } finally {
      setBusy(false);
    }
  }

  async function handlePull() {
    if (!api.pullContainerImage || !query.trim()) {
      return;
    }

    setBusy(true);
    try {
      const result = await api.pullContainerImage(searchRegistry, query.trim());
      await refreshLocalImages();
      setSelectedTarget({
        imageRef: result.image?.imageRef ?? result.imageRef,
        registry: searchRegistry,
        engine: result.engine,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDialogSubmit(input: {
    action: "save-template" | "create-node";
    displayName: string;
    imageRef: string;
    registry: string;
    shell: string;
  }) {
    setBusy(true);
    try {
      if (input.action === "save-template") {
        if (!api.saveContainerTemplate) {
          return;
        }
        await api.saveContainerTemplate({
          displayName: input.displayName,
          imageRef: input.imageRef,
          registry: input.registry,
          shell: input.shell,
        });
        await onTemplateSaved?.();
      } else if (activeLabId && api.createContainerNode) {
        const lab = await api.createContainerNode(activeLabId, {
          displayName: input.displayName,
          imageRef: input.imageRef,
          registry: input.registry,
          shell: input.shell,
        });
        await onNodeCreated?.(lab);
      }

      setSelectedTarget(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-section">
      <div className="panel-section-header">
        <p className="panel-eyebrow">Runtime</p>
        <h2>Containers</h2>
        <p className="panel-description">
          Discover local images, search registries, pull what you need, then
          save reusable templates or drop a one-off node into the active lab.
        </p>
      </div>

      <div className="panel-actions">
        <span className="list-item-badge is-accent">
          Runtime: {runtime.engine ?? "unavailable"}
        </span>
      </div>

      {runtime.message ? <p className="form-error">{runtime.message}</p> : null}

      <div className="panel-section">
        <div className="panel-section-header">
          <p className="panel-eyebrow">Search</p>
          <h3>Registry Search</h3>
        </div>
        <label className="field">
          <span className="field-label">Registry</span>
          <select
            className="field-input"
            aria-label="Container Registry"
            value={searchRegistry}
            onChange={(event) => setSearchRegistry(event.target.value)}
          >
            <option value="docker-hub">Docker Hub</option>
            <option value="ghcr">GitHub Container Registry</option>
            <option value="quay">Quay</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Image Search</span>
          <input
            className="field-input"
            aria-label="Container Search Query"
            placeholder="oraclelinux:9-slim"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleSearch();
              }
            }}
          />
        </label>
        <div className="panel-actions">
          <button
            type="button"
            className="btn"
            onClick={() => void handleSearch()}
            disabled={busy || !query.trim()}
          >
            Search
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handlePull()}
            disabled={busy || !query.trim() || !runtime.available}
          >
            Pull Image
          </button>
        </div>
      </div>

      {searchResults.length > 0 ? (
        <ul
          className="entity-list entity-list--dense"
          aria-label="Container search results"
        >
          {searchResults.map((result) => (
            <li
              key={`${result.registry}:${result.imageRef}`}
              className="entity-list-item"
            >
              <div className="resource-card">
                <div className="resource-card-copy">
                  <span className="resource-card-label">{result.registry}</span>
                  <strong className="resource-card-title">
                    {result.imageRef}
                  </strong>
                  <p className="resource-card-meta">
                    {result.description ?? result.repository}
                    {typeof result.stars === "number"
                      ? ` • ${result.stars} stars`
                      : ""}
                  </p>
                </div>
                <div className="resource-card-controls">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      setSelectedTarget({
                        imageRef: result.imageRef,
                        registry: result.registry,
                        engine: runtime.engine,
                      })
                    }
                  >
                    Use...
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="panel-section">
        <div className="panel-section-header">
          <p className="panel-eyebrow">Local</p>
          <h3>Available Images</h3>
        </div>
        {localImages.length === 0 ? (
          <div className="panel-empty panel-empty--compact">
            <h3>No local container images</h3>
            <p>
              Pull an image or use an existing runtime cache to populate this
              list.
            </p>
          </div>
        ) : (
          <ul
            className="entity-list entity-list--dense"
            aria-label="Local container images"
          >
            {localImages.map((image) => (
              <li key={image.id} className="entity-list-item">
                <div className="resource-card">
                  <div className="resource-card-copy">
                    <span className="resource-card-label">
                      {runtime.engine ?? "runtime"}
                    </span>
                    <strong className="resource-card-title">
                      {image.imageRef}
                    </strong>
                    <p className="resource-card-meta">
                      {image.repository}:{image.tag}
                      {image.size ? ` • ${image.size}` : ""}
                    </p>
                  </div>
                  <div className="resource-card-controls">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        setSelectedTarget({
                          imageRef: image.imageRef,
                          registry: searchRegistry,
                          engine: runtime.engine,
                        })
                      }
                    >
                      Use...
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ContainerImageActionDialog
        open={selectedTarget !== null}
        target={selectedTarget}
        activeLabId={activeLabId}
        saving={busy}
        onClose={() => setSelectedTarget(null)}
        onSubmit={handleDialogSubmit}
      />
    </section>
  );
}
