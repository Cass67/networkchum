import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ImageRepoSummary,
  RepoListingSummary,
  RepoPullSummary,
} from "../api/client.js";

import { ConfirmDialog } from "./ConfirmDialog.js";

type ImageRepoBrowserProps = {
  repos: ImageRepoSummary[];
  onAddRepo: (input: {
    name: string;
    kind: "local" | "url";
    path?: string;
    url?: string;
  }) => Promise<ImageRepoSummary>;
  onRemoveRepo: (repoId: string) => Promise<void>;
  onLoadRepoEntries: (
    repoId: string,
    dirPath: string,
  ) => Promise<RepoListingSummary>;
  onStartRepoPull: (
    repoId: string,
    entryPath: string,
  ) => Promise<RepoPullSummary>;
  onLoadRepoPulls: (repoId: string) => Promise<RepoPullSummary[]>;
  onPullComplete: () => void | Promise<void>;
};

type AddDialogState =
  | { open: false }
  | {
      open: true;
      name: string;
      kind: "local" | "url";
      location: string;
      busy: boolean;
      error: string | null;
    };

function formatBytes(sizeBytes: number | null): string {
  if (sizeBytes == null) {
    return "";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = sizeBytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

function repoLocation(repo: ImageRepoSummary): string {
  return repo.kind === "local" ? (repo.path ?? "") : (repo.url ?? "");
}

function parentPath(dirPath: string): string {
  const trimmed = dirPath.replace(/\/+$/, "");
  if (trimmed === "") {
    return "/";
  }
  const parent = trimmed.slice(0, trimmed.lastIndexOf("/"));
  return parent === "" ? "/" : parent;
}

function pathSegments(dirPath: string): Array<{ label: string; path: string }> {
  const segments = [{ label: "Root", path: "/" }];
  if (dirPath === "/") {
    return segments;
  }
  let accumulated = "";
  for (const segment of dirPath.replace(/^\/+/, "").split("/")) {
    accumulated += `/${segment}`;
    segments.push({ label: segment, path: accumulated });
  }
  return segments;
}

export function ImageRepoBrowser({
  repos,
  onAddRepo,
  onRemoveRepo,
  onLoadRepoEntries,
  onStartRepoPull,
  onLoadRepoPulls,
  onPullComplete,
}: ImageRepoBrowserProps) {
  const [addDialog, setAddDialog] = useState<AddDialogState>({ open: false });
  const [browsedRepoId, setBrowsedRepoId] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("/");
  const [listing, setListing] = useState<RepoListingSummary | null>(null);
  const [listingBusy, setListingBusy] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [pulls, setPulls] = useState<RepoPullSummary[]>([]);
  const [notifiedPulls, setNotifiedPulls] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [confirmRemoveRepoId, setConfirmRemoveRepoId] = useState<string | null>(
    null,
  );
  const [startingPullPath, setStartingPullPath] = useState<string | null>(null);
  const onLoadRepoPullsRef = useRef(onLoadRepoPulls);
  const onPullCompleteRef = useRef(onPullComplete);
  const onLoadRepoEntriesRef = useRef(onLoadRepoEntries);
  const onStartRepoPullRef = useRef(onStartRepoPull);
  onLoadRepoPullsRef.current = onLoadRepoPulls;
  onPullCompleteRef.current = onPullComplete;
  onLoadRepoEntriesRef.current = onLoadRepoEntries;
  onStartRepoPullRef.current = onStartRepoPull;

  const loadEntries = useCallback(async (repoId: string, dirPath: string) => {
    setListingBusy(true);
    setListingError(null);
    try {
      const nextListing = await onLoadRepoEntriesRef.current(repoId, dirPath);
      setListing(nextListing);
    } catch (error) {
      setListing(null);
      setListingError(
        error instanceof Error ? error.message : "Failed to list repo",
      );
    } finally {
      setListingBusy(false);
    }
  }, []);

  function browseRepo(repoId: string) {
    setBrowsedRepoId(repoId);
    setCurrentPath("/");
  }

  function collapseRepo() {
    setBrowsedRepoId(null);
    setListing(null);
    setPulls([]);
    setListingError(null);
  }

  // Load directory entries whenever the browsed repo or path changes.
  useEffect(() => {
    if (!browsedRepoId) {
      return;
    }
    void loadEntries(browsedRepoId, currentPath);
  }, [browsedRepoId, currentPath, loadEntries]);

  // Poll pull progress while a repo is browsed; notify once per finished pull.
  useEffect(() => {
    if (!browsedRepoId) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const nextPulls = await onLoadRepoPullsRef.current(browsedRepoId);
        if (cancelled) {
          return;
        }
        setPulls(nextPulls);
        for (const pull of nextPulls) {
          if (pull.status !== "running" && !notifiedPulls.has(pull.id)) {
            setNotifiedPulls((current) => new Set(current).add(pull.id));
            void onPullCompleteRef.current();
          }
        }
      } catch {
        // Polling failures are transient; the next tick retries.
      }
    };
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [browsedRepoId, notifiedPulls]);

  async function handleAddRepo() {
    if (!addDialog.open || addDialog.busy) {
      return;
    }
    const kind = addDialog.kind;
    const location = addDialog.location.trim();
    if (!addDialog.name.trim() || !location) {
      return;
    }
    setAddDialog({ ...addDialog, busy: true, error: null });
    try {
      await onAddRepo(
        kind === "local"
          ? { name: addDialog.name.trim(), kind, path: location }
          : { name: addDialog.name.trim(), kind, url: location },
      );
      setAddDialog({ open: false });
    } catch (error) {
      setAddDialog({
        ...addDialog,
        busy: false,
        error:
          error instanceof Error ? error.message : "Adding the repo failed",
      });
    }
  }

  async function handlePull(entryPath: string) {
    if (!browsedRepoId || startingPullPath) {
      return;
    }
    setStartingPullPath(entryPath);
    try {
      await onStartRepoPullRef.current(browsedRepoId, entryPath);
    } catch {
      // Pull start failures surface via the pulls list on the next poll.
    } finally {
      setStartingPullPath(null);
    }
  }

  const browsedRepo =
    browsedRepoId != null
      ? (repos.find((repo) => repo.id === browsedRepoId) ?? null)
      : null;
  const runningPull = pulls.find((pull) => pull.status === "running") ?? null;
  const latestFinishedPull = pulls.find((pull) => pull.status !== "running");

  return (
    <section className="panel-section">
      <div className="panel-section-header">
        <p className="panel-eyebrow">Sources</p>
        <h2>Image Repos</h2>
        <p className="panel-description">
          Add a local directory or an image URL (including ishare2 shares like
          labhub.eu.org) and pull device images into the catalog.
        </p>
      </div>
      <div className="panel-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            setAddDialog({
              open: true,
              name: "",
              kind: "url",
              location: "",
              busy: false,
              error: null,
            })
          }
        >
          Add Repo
        </button>
      </div>

      {addDialog.open ? (
        <div
          role="dialog"
          aria-label="Add Image Repo"
          className="dialog-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setAddDialog({ open: false });
            }
          }}
        >
          <div className="dialog-card dialog-card--compact">
            <div className="dialog-header">
              <p className="panel-eyebrow">Sources</p>
              <h2>Add Repo</h2>
            </div>
            <label className="field">
              <span className="field-label">Name</span>
              <input
                className="field-input"
                value={addDialog.name}
                onChange={(event) =>
                  setAddDialog({ ...addDialog, name: event.target.value })
                }
                placeholder="LabHub qemu"
              />
            </label>
            <label className="field">
              <span className="field-label">Type</span>
              <select
                className="field-input"
                value={addDialog.kind}
                onChange={(event) =>
                  setAddDialog({
                    ...addDialog,
                    kind: event.target.value as "local" | "url",
                  })
                }
              >
                <option value="url">
                  URL (directory listing, manifest, or ishare2 share)
                </option>
                <option value="local">Local directory</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">
                {addDialog.kind === "local" ? "Directory" : "URL"}
              </span>
              <input
                className="field-input"
                value={addDialog.location}
                onChange={(event) =>
                  setAddDialog({ ...addDialog, location: event.target.value })
                }
                placeholder={
                  addDialog.kind === "local"
                    ? "/path/to/images"
                    : "https://labhub.eu.org/0:/addons/qemu/"
                }
              />
            </label>
            {addDialog.error ? (
              <p className="form-error">{addDialog.error}</p>
            ) : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                onClick={() => setAddDialog({ open: false })}
                disabled={addDialog.busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleAddRepo()}
                disabled={
                  !addDialog.name.trim() ||
                  !addDialog.location.trim() ||
                  addDialog.busy
                }
              >
                {addDialog.busy ? "Adding…" : "Add repo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {repos.length === 0 ? (
        <div className="panel-empty panel-empty--compact">
          <h3>No image repos</h3>
          <p>
            Add a local directory or a URL to browse and pull device images.
          </p>
        </div>
      ) : null}

      <ul className="entity-list entity-list--stack" aria-label="Image repos">
        {repos.map((repo) => {
          const isBrowsed = repo.id === browsedRepoId;
          return (
            <li key={repo.id} className="entity-list-item">
              <div className="resource-card resource-card--stack">
                <div className="resource-card-copy">
                  <div className="list-card-row">
                    <span className="resource-card-button">{repo.name}</span>
                    <span className="list-item-badge">
                      {repo.kind === "local" ? "local" : "url"}
                    </span>
                  </div>
                  <p className="resource-card-meta">{repoLocation(repo)}</p>
                </div>
                <div className="resource-card-controls">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() =>
                      isBrowsed ? collapseRepo() : browseRepo(repo.id)
                    }
                  >
                    {isBrowsed ? "Close" : "Browse"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-dots"
                    aria-label={`Remove repo ${repo.name}`}
                    onClick={() => setConfirmRemoveRepoId(repo.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              {isBrowsed ? (
                <div className="panel-description">
                  {listingError ? (
                    <p className="form-error">{listingError}</p>
                  ) : null}

                  <div className="list-card-row">
                    {pathSegments(currentPath).map((segment, index) => (
                      <button
                        key={segment.path}
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setCurrentPath(segment.path)}
                        disabled={
                          index === pathSegments(currentPath).length - 1
                        }
                      >
                        {segment.label}
                      </button>
                    ))}
                    {currentPath !== "/" ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setCurrentPath(parentPath(currentPath))}
                      >
                        Up
                      </button>
                    ) : null}
                  </div>

                  {listingBusy ? <p>Loading…</p> : null}

                  {listing ? (
                    <ul className="entity-list" aria-label="Repo entries">
                      {listing.folders.map((folder) => (
                        <li key={folder.path} className="entity-list-item">
                          <div className="list-card-row">
                            <button
                              type="button"
                              className="resource-card-button"
                              onClick={() => setCurrentPath(folder.path)}
                            >
                              {folder.name}/
                            </button>
                            <span className="resource-card-meta">
                              {formatBytes(folder.sizeBytes)}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => void handlePull(folder.path)}
                              disabled={startingPullPath != null}
                            >
                              Pull folder
                            </button>
                          </div>
                        </li>
                      ))}
                      {listing.files.map((file) => (
                        <li key={file.path} className="entity-list-item">
                          <div className="list-card-row">
                            <span className="resource-card-button">
                              {file.name}
                            </span>
                            <span className="resource-card-meta">
                              {formatBytes(file.sizeBytes)}
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => void handlePull(file.path)}
                              disabled={startingPullPath != null}
                            >
                              Pull
                            </button>
                          </div>
                        </li>
                      ))}
                      {listing.folders.length === 0 &&
                      listing.files.length === 0 ? (
                        <li className="entity-list-item">
                          <p className="panel-description">
                            No disk images found here.
                          </p>
                        </li>
                      ) : null}
                    </ul>
                  ) : null}

                  {runningPull ? (
                    <p aria-live="polite">
                      Pulling {runningPull.entryPath}
                      {runningPull.currentFile
                        ? ` — ${runningPull.currentFile}`
                        : ""}
                      {runningPull.bytesReceived != null
                        ? ` (${formatBytes(runningPull.bytesReceived)})`
                        : ""}
                    </p>
                  ) : null}
                  {latestFinishedPull && !runningPull ? (
                    <p>
                      {latestFinishedPull.status === "done"
                        ? `Pull complete — ${latestFinishedPull.images.length} image(s) added.`
                        : `Pull failed: ${latestFinishedPull.error ?? "unknown error"}`}
                      {latestFinishedPull.warnings.length > 0 ? (
                        <span>
                          {" "}
                          {latestFinishedPull.warnings.length} warning(s).
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirmRemoveRepoId != null}
        title="Remove repo"
        body={
          confirmRemoveRepoId != null
            ? "The repo source will be removed. Already pulled images stay in the catalog."
            : ""
        }
        onConfirm={() => {
          if (confirmRemoveRepoId != null) {
            if (confirmRemoveRepoId === browsedRepoId) {
              collapseRepo();
            }
            void onRemoveRepo(confirmRemoveRepoId);
          }
          setConfirmRemoveRepoId(null);
        }}
        onCancel={() => setConfirmRemoveRepoId(null)}
      />
    </section>
  );
}
