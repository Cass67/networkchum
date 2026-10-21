import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { listImages } from "../images/imageStore.js";

type App = ReturnType<typeof buildApp>;

let tempDataDir: string;
let app: App;

beforeEach(async () => {
  tempDataDir = await mkdtemp(
    path.join(os.tmpdir(), "networkchum-repo-routes-"),
  );
  process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
  app = buildApp();
});

afterEach(async () => {
  if (tempDataDir?.startsWith(os.tmpdir())) {
    await rm(tempDataDir, { recursive: true, force: true });
  }
});

describe("image repo routes", () => {
  it("adds, lists, browses, pulls from, and removes a local repo", async () => {
    const repoDir = path.join(tempDataDir, "device-images");
    await mkdir(path.join(repoDir, "linux-min"), { recursive: true });
    await writeFile(path.join(repoDir, "linux-min", "virtioa.qcow2"), "disk");

    const create = await app.inject({
      method: "POST",
      url: "/image-repos",
      payload: { name: "Device Dir", kind: "local", path: repoDir },
    });
    expect(create.statusCode).toBe(201);
    const repo = (create.json() as { repo: { id: string } }).repo;
    expect(repo).toMatchObject({
      name: "Device Dir",
      kind: "local",
      path: repoDir,
    });

    const list = await app.inject({ method: "GET", url: "/image-repos" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      repos: [{ id: repo.id, name: "Device Dir" }],
    });

    const rootListing = await app.inject({
      method: "GET",
      url: `/image-repos/${repo.id}/entries`,
    });
    expect(rootListing.statusCode).toBe(200);
    expect(rootListing.json()).toMatchObject({
      repoId: repo.id,
      folders: [
        expect.objectContaining({ name: "linux-min", path: "/linux-min" }),
      ],
      files: [],
    });

    const folderListing = await app.inject({
      method: "GET",
      url: `/image-repos/${repo.id}/entries`,
      query: { path: "/linux-min" },
    });
    expect(folderListing.statusCode).toBe(200);
    expect(folderListing.json()).toMatchObject({
      files: [
        expect.objectContaining({
          name: "virtioa.qcow2",
          path: "/linux-min/virtioa.qcow2",
        }),
      ],
    });

    const pull = await app.inject({
      method: "POST",
      url: `/image-repos/${repo.id}/pulls`,
      payload: { entryPath: "/linux-min" },
    });
    expect(pull.statusCode).toBe(202);
    const pullId = (pull.json() as { pull: { id: string } }).pull.id;

    let finished;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const status = await app.inject({
        method: "GET",
        url: `/image-repos/${repo.id}/pulls`,
      });
      finished = (
        status.json() as { pulls: Array<{ id: string; status: string }> }
      ).pulls.find((entry) => entry.id === pullId);
      if (finished && finished.status !== "running") {
        break;
      }
    }
    expect(finished?.status).toBe("done");
    expect(await listImages()).toEqual([
      expect.objectContaining({
        name: "virtioa.qcow2",
        path: path.join(repoDir, "linux-min", "virtioa.qcow2"),
        source: "pull",
      }),
    ]);

    const remove = await app.inject({
      method: "DELETE",
      url: `/image-repos/${repo.id}`,
    });
    expect(remove.statusCode).toBe(200);
    const listAfterRemove = await app.inject({
      method: "GET",
      url: "/image-repos",
    });
    expect(listAfterRemove.json()).toMatchObject({ repos: [] });
  });

  it("rejects a local repo path that is not a directory", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/image-repos",
      payload: {
        name: "Missing",
        kind: "local",
        path: path.join(tempDataDir, "nope"),
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects a URL repo without http(s)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/image-repos",
      payload: {
        name: "Bad",
        kind: "url",
        url: "ftp://example.test/images/",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("404s when browsing a missing repo", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/image-repos/repo-missing/entries",
    });
    expect(response.statusCode).toBe(404);
  });
});
