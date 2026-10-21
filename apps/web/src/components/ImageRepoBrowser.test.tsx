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

const TEMPLATES = [
  { id: "juniper-vrr", name: "Juniper VRR" },
  { id: "cisco-asr", name: "Cisco ASR" },
];

function renderBrowser(
  overrides: {
    repos?: ImageRepoSummary[];
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
        folders: [],
        files: [
          {
            name: "vJunosEvolved-23.1R1.8.qcow2",
            path: "/vJunosEvolved-23.1R1.8.qcow2",
            kind: "file",
            url: null,
            sizeBytes: 1024,
            checksumMd5: null,
            checksumSha1: null,
          },
          {
            name: "mystery.qcow2",
            path: "/mystery.qcow2",
            kind: "file",
            url: null,
            sizeBytes: 2048,
            checksumMd5: null,
            checksumSha1: null,
          },
        ],
      }),
    );
  const onStartRepoPull =
    overrides.onStartRepoPull ??
    vi.fn(
      async (): Promise<RepoPullSummary> => ({
        id: "pull-1",
        repoId: repo.id,
        entryPath: "/vJunosEvolved-23.1R1.8.qcow2",
        templateId: null,
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        currentFile: null,
        bytesReceived: null,
        totalBytes: null,
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
      repos={overrides.repos ?? [repo]}
      templates={TEMPLATES}
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
        templates={TEMPLATES}
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

  it("suggests a device for recognizable images and lets you pick one", async () => {
    const { onStartRepoPull } = renderBrowser({});

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    await screen.findByText(/vJunosEvolved/i);

    // The name matcher suggests Juniper VRR, shown as a hint and preselected.
    expect(screen.getByText(/looks like Juniper VRR/i)).toBeInTheDocument();
    const select = screen.getByLabelText(
      /Device for vJunosEvolved/i,
    ) as HTMLSelectElement;
    expect(select.value).toBe("juniper-vrr");

    // Unknown images default to "Device?" until the user picks one.
    const mysterySelect = screen.getByLabelText(
      /Device for mystery/i,
    ) as HTMLSelectElement;
    expect(mysterySelect.value).toBe("");

    const row = screen.getByText(/vJunosEvolved/i).closest("li")!;
    const pullButton = [...row.querySelectorAll("button")].find(
      (button) => button.textContent === "Pull",
    )!;
    fireEvent.click(pullButton);
    expect(onStartRepoPull).toHaveBeenCalledWith(
      "repo-labhub",
      "/vJunosEvolved-23.1R1.8.qcow2",
      "juniper-vrr",
    );
  });

  it("shows a progress bar with percent while pulling", async () => {
    vi.useFakeTimers();
    try {
      const running: RepoPullSummary = {
        id: "pull-1",
        repoId: "repo-labhub",
        entryPath: "/vJunosEvolved-23.1R1.8.qcow2",
        templateId: "juniper-vrr",
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        currentFile: null,
        bytesReceived: 512,
        totalBytes: 1024,
        images: [],
        warnings: [],
        error: null,
      };
      const done: RepoPullSummary = {
        ...running,
        status: "done",
        finishedAt: new Date().toISOString(),
        images: ["img-1"],
      };
      const onLoadRepoPulls = vi
        .fn()
        .mockImplementationOnce(async () => [] as RepoPullSummary[])
        .mockImplementationOnce(async () => [running])
        .mockImplementation(async () => [done]);
      const { onStartRepoPull } = renderBrowser({ onLoadRepoPulls });
      void onStartRepoPull;

      fireEvent.click(screen.getByRole("button", { name: "Browse" }));

      await vi.advanceTimersByTimeAsync(1100);
      expect(
        screen.getByRole("progressbar").getAttribute("aria-valuenow"),
      ).toBe("50");
      expect(screen.getByText(/50%/)).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(1100);
      await vi.advanceTimersByTimeAsync(1100);
      expect(screen.getByText(/Pull complete/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps pull buttons disabled while a pull runs", async () => {
    vi.useFakeTimers();
    try {
      const running: RepoPullSummary = {
        id: "pull-1",
        repoId: "repo-labhub",
        entryPath: "/vJunosEvolved-23.1R1.8.qcow2",
        templateId: null,
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        currentFile: null,
        bytesReceived: null,
        totalBytes: null,
        images: [],
        warnings: [],
        error: null,
      };
      const onLoadRepoPulls = vi.fn().mockImplementation(async () => [running]);
      renderBrowser({ onLoadRepoPulls });

      fireEvent.click(screen.getByRole("button", { name: "Browse" }));
      await vi.advanceTimersByTimeAsync(1100);

      const pulls = [...screen.getAllByRole("button", { name: /Pull/ })];
      expect(pulls.length).toBeGreaterThan(0);
      expect(pulls.every((button) => button.hasAttribute("disabled"))).toBe(
        true,
      );
      expect(screen.getByText(/Pulling \/vJunosEvolved/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
