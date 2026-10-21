import { stat } from "node:fs/promises";

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { AppDependencies } from "../app.js";
import type { ImageRepo, RepoListing } from "@networkchum/shared";

import { listImageRepos, saveImageRepos } from "../images/repoStore.js";
import { listRepoEntries } from "../images/repoListing.js";
import { listRepoPulls, startRepoPull } from "../images/pullRepoImage.js";

const addRepoBodySchema = z
  .object({
    name: z.string().trim().min(1),
    kind: z.enum(["local", "url"]),
    path: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1).optional(),
  })
  .refine(
    (body) =>
      (body.kind === "local" && body.path != null) ||
      (body.kind === "url" && body.url != null),
    { message: "Local repos need a path; URL repos need a URL" },
  );

const entriesQuerySchema = z.object({
  path: z.string().trim().default("/"),
});

const pullBodySchema = z.object({
  entryPath: z.string().trim().min(1),
});

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "repo"
  );
}

export const imageRepoRoutes: FastifyPluginAsync<AppDependencies> = async (
  app,
  options,
) => {
  const fetcher = options.runtime?.fetcher;

  app.get("/image-repos", async () => {
    return { repos: await listImageRepos() };
  });

  app.post("/image-repos", async (request, reply) => {
    const body = addRepoBodySchema.parse(request.body);

    if (body.kind === "local") {
      const targetStat = await stat(body.path!).catch(() => null);
      if (!targetStat?.isDirectory()) {
        return reply
          .code(400)
          .send({ message: `Path is not a directory: ${body.path}` });
      }
    } else {
      const parsedUrl = new URL(body.url!);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return reply
          .code(400)
          .send({ message: "Repo URL must use http or https" });
      }
    }

    const repo: ImageRepo = {
      id: `repo-${Date.now()}-${slugify(body.name)}`,
      name: body.name,
      kind: body.kind,
      path: body.path,
      url: body.url,
      addedAt: new Date().toISOString(),
    };

    const repos = await listImageRepos();
    await saveImageRepos([...repos, repo]);
    return reply.code(201).send({ repo });
  });

  app.delete("/image-repos/:repoId", async (request, reply) => {
    const { repoId } = z
      .object({ repoId: z.string().min(1) })
      .parse(request.params);
    const repos = await listImageRepos();
    const index = repos.findIndex((repo) => repo.id === repoId);
    if (index === -1) {
      return reply.code(404).send({ message: "Repo not found" });
    }
    const [repo] = repos.splice(index, 1);
    await saveImageRepos(repos);
    return reply.send({ repo });
  });

  app.get("/image-repos/:repoId/entries", async (request, reply) => {
    const { repoId } = z
      .object({ repoId: z.string().min(1) })
      .parse(request.params);
    const { path: dirPath } = entriesQuerySchema.parse(request.query);

    const repo = (await listImageRepos()).find((entry) => entry.id === repoId);
    if (!repo) {
      return reply.code(404).send({ message: "Repo not found" });
    }

    let listing: RepoListing;
    try {
      listing = await listRepoEntries({ repo, dirPath, fetcher });
    } catch (error) {
      const status = repo.kind === "local" ? 400 : 502;
      return reply.code(status).send({
        message:
          error instanceof Error
            ? error.message
            : "Failed to list repo entries",
      });
    }

    return reply.send(listing);
  });

  app.post("/image-repos/:repoId/pulls", async (request, reply) => {
    const { repoId } = z
      .object({ repoId: z.string().min(1) })
      .parse(request.params);
    const { entryPath } = pullBodySchema.parse(request.body);

    const repo = (await listImageRepos()).find((entry) => entry.id === repoId);
    if (!repo) {
      return reply.code(404).send({ message: "Repo not found" });
    }

    let pull;
    try {
      pull = await startRepoPull({ repo, entryPath, fetcher });
    } catch (error) {
      return reply.code(400).send({
        message:
          error instanceof Error ? error.message : "Failed to start pull",
      });
    }

    return reply.code(202).send({ pull });
  });

  app.get("/image-repos/:repoId/pulls", async (request, reply) => {
    const { repoId } = z
      .object({ repoId: z.string().min(1) })
      .parse(request.params);
    const repo = (await listImageRepos()).find((entry) => entry.id === repoId);
    if (!repo) {
      return reply.code(404).send({ message: "Repo not found" });
    }
    return reply.send({ pulls: listRepoPulls(repoId) });
  });
};
