import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ImageRepoSummary,
  RepoListingSummary,
  RepoPullSummary,
} from "../api/client.js";
import { ImageRepoBrowser } from "./ImageRepoBrowser.js";

afterEach(() => {
  cleanup();
});

function renderBrowser(
  overrides: {
    onLoadRepoEntries?: (
      repoId: string,
      dirPath: string,
    ) => Promise<RepoListingSummary>;
    onStartRepoPull?: (
      repoId: string,
      entryPath: string,
    ) => Promise<RepoPullSummary>;
    onLoadRepoPulls?: (repoId: string) => Promise<RepoPullSummary[]>;
  } = {},
) {
  const repo: ImageRepoSummary = {
    id: "repo-labhub",
    name: "LabHub qemu",
    kind: "url",
    url: "https://labhub.eu.org/0:/addons/qemu/",
    addedAt: new Date().toISOString(),
  };
  const onLoadRepoEntries =
    overrides.onLoadRepoEntries ??
    vi.fn(
      async (): Promise<RepoListingSummary> => ({
        repoId: repo.id,
        path: "/",
        folders: [
          {
            name: "linux-min",
            path: "/linux-min",
            kind: "folder",
            url: null,
            sizeBytes: 1024,
            checksumMd5: null,
            checksumSha1: null,
          },
        ],
        files: [],
      }),
    );
  const onStartRepoPull =
    overrides.onStartRepoPull ??
    vi.fn(
      async (): Promise<RepoPullSummary> => ({
        id: "pull-1",
        repoId: repo.id,
        entryPath: "/linux-min",
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        currentFile: null,
        bytesReceived: null,
        images: [],
        warnings: [],
        error: null,
      }),
    );
  const onLoadRepoPulls =
    overrides.onLoadRepoPulls ??
    vi.fn(async (): Promise<RepoPullSummary[]> => []);

  render(
    <ImageRepoBrowser
      repos={[repo]}
      onAddRepo={vi.fn()}
      onRemoveRepo={vi.fn()}
      onLoadRepoEntries={onLoadRepoEntries}
      onStartRepoPull={onStartRepoPull}
      onLoadRepoPulls={onLoadRepoPulls}
      onPullComplete={vi.fn()}
    />,
  );

  return { onLoadRepoEntries, onStartRepoPull, onLoadRepoPulls };
}

describe("ImageRepoBrowser", () => {
  it("adds a URL repo through the dialog", () => {
    const onAddRepo = vi.fn(async () => {
      throw new Error("unused");
    });

    render(
      <ImageRepoBrowser
        repos={[]}
        onAddRepo={onAddRepo}
        onRemoveRepo={vi.fn()}
        onLoadRepoEntries={vi.fn()}
        onStartRepoPull={vi.fn()}
        onLoadRepoPulls={vi.fn()}
        onPullComplete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Repo" }));
    fireEvent.change(screen.getByLabelText(/Name/i), {
      target: { value: "LabHub qemu" },
    });
    fireEvent.change(screen.getByLabelText(/^URL$/i), {
      target: { value: "https://labhub.eu.org/0:/addons/qemu/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add repo" }));

    expect(onAddRepo).toHaveBeenCalledWith({
      name: "LabHub qemu",
      kind: "url",
      url: "https://labhub.eu.org/0:/addons/qemu/",
    });
  });

  it("browses a repo and pulls a folder", async () => {
    const { onLoadRepoEntries, onStartRepoPull } = renderBrowser({});
    const repoBrowser = new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));

    await repoBrowser;
    expect(onLoadRepoEntries).toHaveBeenCalledWith("repo-labhub", "/");
    expect(screen.getByText(/linux-min\//i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pull folder" }));
    expect(onStartRepoPull).toHaveBeenCalledWith("repo-labhub", "/linux-min");
  });

  it("shows pull progress and completion", async () => {
    vi.useFakeTimers();
    try {
      const running: RepoPullSummary = {
        id: "pull-1",
        repoId: "repo-labhub",
        entryPath: "/linux-min",
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        currentFile: "/linux-min/virtioa.qcow2",
        bytesReceived: 2048,
        images: [],
        warnings: [],
        error: null,
      };
      const done: RepoPullSummary = {
        ...running,
        status: "done",
        currentFile: null,
        finishedAt: new Date().toISOString(),
        images: ["img-1"],
      };
      const onLoadRepoPulls = vi
        .fn()
        .mockImplementationOnce(async () => [] as RepoPullSummary[])
        .mockImplementation(async () => [running] as RepoPullSummary[]);
      const { onLoadRepoEntries } = renderBrowser({ onLoadRepoPulls });
      void onLoadRepoEntries;

      fireEvent.click(screen.getByRole("button", { name: "Browse" }));

      await vi.advanceTimersByTimeAsync(2100);
      expect(screen.getByText(/Pulling \/linux-min/i)).toBeInTheDocument();

      onLoadRepoPulls.mockImplementation(async () => [done]);
      await vi.advanceTimersByTimeAsync(2100);
      await vi.advanceTimersByTimeAsync(2100);
      expect(screen.getByText(/Pull complete/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
