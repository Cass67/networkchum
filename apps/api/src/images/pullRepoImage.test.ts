import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type { ImageRepo, RepoPull } from "@networkchum/shared";
import { listImages } from "./imageStore.js";
import { getRepoPull, startRepoPull } from "./pullRepoImage.js";

const execFileAsync = promisify(execFile);

const QCOW2_CONTENT = "qcow2-disk-content";

async function waitForPull(pullId: string): Promise<RepoPull> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const pull = getRepoPull(pullId);
    if (pull && pull.status !== "running") {
      return pull;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Pull did not finish in time");
}

describe("repo pulls", () => {
  let tempDataDir: string;

  beforeEach(async () => {
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-pull-"));
    process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
  });

  afterEach(async () => {
    if (tempDataDir?.startsWith(os.tmpdir())) {
      await rm(tempDataDir, { recursive: true, force: true });
    }
  });

  function manifestRepo(): ImageRepo {
    return {
      id: "repo-manifest",
      name: "Index",
      kind: "url",
      url: "https://example.test/index.json",
      addedAt: new Date().toISOString(),
    };
  }

  it("registers a local folder's disk images in place", async () => {
    const repoDir = path.join(tempDataDir, "repo");
    await mkdir(path.join(repoDir, "linux-min"), { recursive: true });
    await writeFile(path.join(repoDir, "linux-min", "virtioa.qcow2"), "one");
    await writeFile(path.join(repoDir, "linux-min", "notes.txt"), "two");

    const repo: ImageRepo = {
      id: "repo-local",
      name: "Local",
      kind: "local",
      path: repoDir,
      addedAt: new Date().toISOString(),
    };

    const pull = await startRepoPull({ repo, entryPath: "/linux-min" });
    const finished = await waitForPull(pull.id);

    expect(finished.status).toBe("done");
    expect(finished.error).toBeNull();
    expect(finished.images).toHaveLength(1);

    const images = await listImages();
    expect(images).toEqual([
      expect.objectContaining({
        name: "virtioa.qcow2",
        path: path.join(repoDir, "linux-min", "virtioa.qcow2"),
        source: "pull",
        catalogState: "active",
        suggestedTemplateId: null,
      }),
    ]);
  });

  it("rejects pull paths outside a local repo root", async () => {
    const repo: ImageRepo = {
      id: "repo-local",
      name: "Local",
      kind: "local",
      path: path.join(tempDataDir, "repo"),
      addedAt: new Date().toISOString(),
    };

    const pull = await startRepoPull({ repo, entryPath: "/../../etc" });
    const finished = await waitForPull(pull.id);

    expect(finished.status).toBe("error");
    expect(finished.error).toMatch(/outside the repo root/i);
  });

  it("downloads, skips scripts, and registers disk images from a URL repo", async () => {
    const md5 = createHash("md5").update(QCOW2_CONTENT).digest("hex");
    const manifest = {
      images: [
        {
          name: "linux-min",
          files: [
            {
              path: "/linux-min/virtioa.qcow2",
              size: QCOW2_CONTENT.length,
              checksum: { md5 },
            },
            {
              path: "/linux-min/install.sh",
              size: 1,
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
      if (url === "https://example.test/linux-min/virtioa.qcow2") {
        return new Response(QCOW2_CONTENT, { status: 200 });
      }
      return new Response("nope", { status: 404 });
    }) as typeof fetch;

    const pull = await startRepoPull({
      repo: manifestRepo(),
      entryPath: "/linux-min",
      fetcher,
    });
    const finished = await waitForPull(pull.id);

    expect(finished.status).toBe("done");
    expect(finished.error).toBeNull();
    expect(finished.warnings).toEqual([expect.stringContaining("install.sh")]);
    expect(finished.images).toHaveLength(1);
    expect(finished.bytesReceived).toBe(QCOW2_CONTENT.length);
    // The skipped install.sh still counts toward the expected total.
    expect(finished.totalBytes).toBe(QCOW2_CONTENT.length + 1);

    const images = await listImages();
    expect(images).toEqual([
      expect.objectContaining({
        name: "virtioa.qcow2",
        path: path.join(
          tempDataDir,
          "images",
          "repos",
          "repo-manifest",
          "linux-min",
          "virtioa.qcow2",
        ),
        source: "pull",
        catalogState: "active",
      }),
    ]);
    expect(await readFile(images[0]!.path, "utf8")).toBe(QCOW2_CONTENT);
  });

  it("fails the pull when a checksum mismatches", async () => {
    const manifest = {
      images: [
        {
          name: "linux-min",
          files: [
            {
              path: "/linux-min/virtioa.qcow2",
              size: QCOW2_CONTENT.length,
              checksum: { md5: "deadbeef" },
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
      return new Response(QCOW2_CONTENT, { status: 200 });
    }) as typeof fetch;

    const pull = await startRepoPull({
      repo: manifestRepo(),
      entryPath: "/linux-min",
      fetcher,
    });
    const finished = await waitForPull(pull.id);

    expect(finished.status).toBe("error");
    expect(finished.error).toMatch(/MD5 mismatch/i);
    expect(await listImages()).toEqual([]);
  });

  it("extracts archives and registers the disk images inside", async () => {
    const stagingDir = path.join(tempDataDir, "staging");
    await mkdir(stagingDir, { recursive: true });
    await writeFile(path.join(stagingDir, "hda.qcow2"), QCOW2_CONTENT);
    const archivePath = path.join(stagingDir, "image.tgz");
    await execFileAsync("tar", [
      "-czf",
      archivePath,
      "-C",
      stagingDir,
      "hda.qcow2",
    ]);
    const archive = await readFile(archivePath);

    const manifest = {
      images: [
        {
          name: "csr1000v",
          files: [
            {
              path: "/csr1000v/image.tgz",
              size: archive.byteLength,
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
      if (url === "https://example.test/csr1000v/image.tgz") {
        return new Response(archive, {
          status: 200,
          headers: { "content-type": "application/x-tgz" },
        });
      }
      return new Response("nope", { status: 404 });
    }) as typeof fetch;

    const pull = await startRepoPull({
      repo: manifestRepo(),
      entryPath: "/csr1000v",
      fetcher,
    });
    const finished = await waitForPull(pull.id);

    expect(finished.status).toBe("done");
    expect(finished.error).toBeNull();
    expect(finished.images).toHaveLength(1);

    const images = await listImages();
    expect(images[0]?.name).toBe("hda.qcow2");
    expect(images[0]?.suggestedTemplateId).toBe("cisco-asr");

    // The archive itself is gone after extraction; only the disk image
    // remains.
    const targetDir = path.join(
      tempDataDir,
      "images",
      "repos",
      "repo-manifest",
      "csr1000v",
    );
    expect(await readdir(targetDir)).toEqual(["hda.qcow2"]);
  });

  it("binds pulled images to the chosen template", async () => {
    const md5 = createHash("md5").update(QCOW2_CONTENT).digest("hex");
    const manifest = {
      images: [
        {
          name: "linux-min",
          files: [
            {
              path: "/linux-min/virtioa.qcow2",
              size: QCOW2_CONTENT.length,
              checksum: { md5 },
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
      return new Response(QCOW2_CONTENT, { status: 200 });
    }) as typeof fetch;

    const pull = await startRepoPull({
      repo: manifestRepo(),
      entryPath: "/linux-min",
      fetcher,
      templateId: "juniper-vrr",
    });
    const finished = await waitForPull(pull.id);

    expect(finished.status).toBe("done");
    expect(finished.templateId).toBe("juniper-vrr");
    expect(finished.images).toHaveLength(1);

    const images = await listImages();
    expect(images[0]?.templateId).toBe("juniper-vrr");
  });
});
