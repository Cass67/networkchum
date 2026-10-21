import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listRepoEntries, listRepoFolderFiles } from "./repoListing.js";
import type { ImageRepo } from "@networkchum/shared";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-repo-listing-"));
});

afterEach(async () => {
  if (tempDir?.startsWith(os.tmpdir())) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("local repo listing", () => {
  it("lists folders and disk-image files under a directory", async () => {
    await mkdir(path.join(tempDir, "linux-min"));
    await writeFile(path.join(tempDir, "linux-min", "virtioa.qcow2"), "a");
    await writeFile(path.join(tempDir, "readme.txt"), "b");

    const repo: ImageRepo = {
      id: "repo-1",
      name: "Local",
      kind: "local",
      path: tempDir,
      addedAt: new Date().toISOString(),
    };

    const listing = await listRepoEntries({ repo });

    expect(listing.folders).toEqual([
      expect.objectContaining({ name: "linux-min", path: "/linux-min" }),
    ]);
    expect(listing.files).toEqual([]);
  });

  it("lists files directly in the requested subdirectory", async () => {
    await mkdir(path.join(tempDir, "linux-min"));
    await writeFile(path.join(tempDir, "linux-min", "virtioa.qcow2"), "a");

    const repo: ImageRepo = {
      id: "repo-1",
      name: "Local",
      kind: "local",
      path: tempDir,
      addedAt: new Date().toISOString(),
    };

    const listing = await listRepoEntries({ repo, dirPath: "/linux-min" });

    expect(listing.folders).toEqual([]);
    expect(listing.files).toEqual([
      expect.objectContaining({
        name: "virtioa.qcow2",
        path: "/linux-min/virtioa.qcow2",
        sizeBytes: 1,
      }),
    ]);
  });

  it("collects every disk image under a folder recursively", async () => {
    await mkdir(path.join(tempDir, "linux-min", "nested"), {
      recursive: true,
    });
    await writeFile(path.join(tempDir, "linux-min", "virtioa.qcow2"), "a");
    await writeFile(
      path.join(tempDir, "linux-min", "nested", "hdb.qcow2"),
      "b",
    );

    const repo: ImageRepo = {
      id: "repo-1",
      name: "Local",
      kind: "local",
      path: tempDir,
      addedAt: new Date().toISOString(),
    };

    const files = await listRepoFolderFiles({ repo, folderPath: "/linux-min" });

    expect(files.map((file) => file.path).sort()).toEqual([
      "/linux-min/nested/hdb.qcow2",
      "/linux-min/virtioa.qcow2",
    ]);
  });

  it("rejects directories outside the repo root", async () => {
    const repo: ImageRepo = {
      id: "repo-1",
      name: "Local",
      kind: "local",
      path: tempDir,
      addedAt: new Date().toISOString(),
    };

    await expect(
      listRepoEntries({ repo, dirPath: "/../../etc" }),
    ).rejects.toThrow(/outside the repo root/i);
  });
});

describe("ishare2 share listing (labhub-style)", () => {
  const qemuIndex = {
    schema_version: "1.0",
    url_properties: {
      protocol: "https",
      hostnames: { main: "labhub.eu.org" },
      prefixes: { main: "/0:" },
    },
    images: [
      {
        id: 1,
        name: "linux-min",
        type: "qemu",
        files: [
          {
            filename: "virtioa.qcow2",
            path: "/addons/qemu/linux-min/virtioa.qcow2",
            size: 3,
          },
        ],
      },
      {
        id: 2,
        name: "Linux",
        type: "qemu",
        files: [
          {
            filename: "Path.txt",
            path: "/addons/qemu/Linux/Path.txt",
            size: 10,
          },
          {
            filename: "hda.qcow2",
            path: "/addons/qemu/Linux/hda.qcow2",
            size: 4,
          },
        ],
      },
    ],
  };

  function fakeIshare2Fetcher(): typeof fetch {
    return (async (input: unknown) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("releases/latest")) {
        return new Response(
          JSON.stringify({
            assets: [
              {
                name: "qemu.json",
                browser_download_url: "https://example.test/qemu.json",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === "https://example.test/qemu.json") {
        return new Response(JSON.stringify(qemuIndex), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
  }

  const repo: ImageRepo = {
    id: "repo-labhub",
    name: "LabHub",
    kind: "url",
    url: "https://labhub.eu.org/0:/addons/qemu/",
    addedAt: new Date().toISOString(),
  };

  it("maps index paths to repo-relative folders and files", async () => {
    const listing = await listRepoEntries({
      repo,
      fetcher: fakeIshare2Fetcher(),
    });

    expect(listing.folders.map((folder) => folder.path).sort()).toEqual([
      "/Linux",
      "/linux-min",
    ]);
    expect(listing.files).toEqual([]);
  });

  it("resolves download URLs against the repo host", async () => {
    const files = await listRepoFolderFiles({
      repo: {
        ...repo,
        url: "https://drive.labhub.eu.org/0:/addons/qemu/",
      },
      folderPath: "/Linux",
      fetcher: fakeIshare2Fetcher(),
    });

    expect(files.map((file) => file.url).sort()).toEqual([
      "https://drive.labhub.eu.org/0:/addons/qemu/Linux/Path.txt",
      "https://drive.labhub.eu.org/0:/addons/qemu/Linux/hda.qcow2",
    ]);
  });

  it("lists a subdirectory and accumulates folder sizes", async () => {
    const listing = await listRepoEntries({
      repo,
      dirPath: "/linux-min",
      fetcher: fakeIshare2Fetcher(),
    });

    expect(listing.folders).toEqual([]);
    expect(listing.files).toEqual([
      expect.objectContaining({
        name: "virtioa.qcow2",
        path: "/linux-min/virtioa.qcow2",
        sizeBytes: 3,
        url: "https://labhub.eu.org/0:/addons/qemu/linux-min/virtioa.qcow2",
      }),
    ]);

    const rootListing = await listRepoEntries({
      repo,
      fetcher: fakeIshare2Fetcher(),
    });
    expect(
      rootListing.folders.find((folder) => folder.name === "Linux")?.sizeBytes,
    ).toBe(14);
  });

  it("collects all files under an image folder", async () => {
    const files = await listRepoFolderFiles({
      repo,
      folderPath: "/Linux",
      fetcher: fakeIshare2Fetcher(),
    });

    expect(files.map((file) => file.path).sort()).toEqual([
      "/Linux/Path.txt",
      "/Linux/hda.qcow2",
    ]);
  });
});

describe("JSON manifest listing", () => {
  it("uses the manifest's url_properties for download URLs", async () => {
    const manifest = {
      url_properties: {
        protocol: "https",
        hostnames: { main: "mirror.example.test" },
        prefixes: { main: "/0:" },
      },
      images: [
        {
          name: "csr",
          files: [
            {
              path: "/addons/qemu/csr/hda.qcow2",
              size: 5,
              checksum: { md5: "md5hash", sha1: "sha1hash" },
            },
          ],
        },
      ],
    };

    const fetcher = (async (input: unknown) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "https://example.test/index.json") {
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    }) as typeof fetch;

    const repo: ImageRepo = {
      id: "repo-manifest",
      name: "Index",
      kind: "url",
      url: "https://example.test/index.json",
      addedAt: new Date().toISOString(),
    };

    const listing = await listRepoEntries({ repo, fetcher });

    expect(listing.folders).toEqual([
      expect.objectContaining({ name: "addons", path: "/addons" }),
    ]);
    expect(listing.files).toEqual([]);

    const files = await listRepoFolderFiles({
      repo,
      folderPath: "/addons/qemu/csr",
      fetcher,
    });

    expect(files).toEqual([
      expect.objectContaining({
        path: "/addons/qemu/csr/hda.qcow2",
        url: "https://mirror.example.test/0:/addons/qemu/csr/hda.qcow2",
        checksumMd5: "md5hash",
        checksumSha1: "sha1hash",
      }),
    ]);
  });
});

describe("HTML directory listing", () => {
  it("parses nginx-style autoindex entries", async () => {
    const rootHtml = `<html><body>
      <a href="../">Parent</a>
      <a href="linux-min/">linux-min/</a>
      <a href="csr1000v/">csr1000v/</a>
      <a href="?sort=name">Name</a>
    </body></html>`;
    const csrHtml = `<html><body>
      <a href="../">Parent</a>
      <a href="hda.qcow2">hda.qcow2</a>
    </body></html>`;

    const fetcher = (async (input: unknown) => {
      const url = typeof input === "string" ? input : String(input);
      if (url === "https://example.test/images/") {
        return new Response(rootHtml, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url === "https://example.test/images/csr1000v/") {
        return new Response(csrHtml, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("nope", { status: 404 });
    }) as typeof fetch;

    const repo: ImageRepo = {
      id: "repo-html",
      name: "Mirror",
      kind: "url",
      url: "https://example.test/images/",
      addedAt: new Date().toISOString(),
    };

    const listing = await listRepoEntries({ repo, fetcher });

    expect(listing.folders).toEqual([
      expect.objectContaining({ name: "linux-min", path: "/linux-min" }),
      expect.objectContaining({ name: "csr1000v", path: "/csr1000v" }),
    ]);
    expect(listing.files).toEqual([]);

    const csrListing = await listRepoEntries({
      repo,
      dirPath: "/csr1000v",
      fetcher,
    });

    expect(csrListing.files).toEqual([
      expect.objectContaining({
        name: "hda.qcow2",
        path: "/csr1000v/hda.qcow2",
        url: "https://example.test/images/csr1000v/hda.qcow2",
      }),
    ]);
  });
});
