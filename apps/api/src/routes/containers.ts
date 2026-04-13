import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import type { Template } from "@networkchum/shared";

import type { AppDependencies } from "../app.js";
import {
  detectContainerEngine,
  listLocalContainerImages,
  pullContainerImage,
  searchContainerImages,
} from "../runtime/container/containerRuntimeService.js";
import { saveUserContainerTemplate } from "../runtime/container/userContainerTemplateStore.js";

const execFileAsync = promisify(execFile);

async function defaultRunCommand(command: string, args: string[]) {
  try {
    const result = await execFileAsync(command, args);
    return {
      ok: true,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Command failed",
    };
  }
}

async function defaultHasBinary(command: string) {
  const result = await defaultRunCommand("which", [command]);
  return result.ok && result.stdout.trim().length > 0;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function titleCase(value: string): string {
  return value
    .split(/[\s._/-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferDisplayName(imageRef: string): string {
  const repository = imageRef.split(":")[0] ?? imageRef;
  const baseName = repository.split("/").filter(Boolean).at(-1) ?? repository;
  const tag = imageRef.includes(":") ? imageRef.split(":").at(-1) : null;
  return tag ? `${titleCase(baseName)} ${tag}` : titleCase(baseName);
}

function inferVendor(imageRef: string): string {
  const repository = imageRef.split(":")[0] ?? imageRef;
  const segments = repository.split("/").filter(Boolean);
  const vendorSource =
    segments.length > 1 && segments[0] !== "library"
      ? segments[0]
      : (segments.at(-1) ?? repository);
  return titleCase(vendorSource);
}

function buildUserContainerTemplate(input: {
  displayName: string;
  imageRef: string;
  registry: string;
  engine: "docker" | "podman";
  shell?: string;
  vendor?: string;
}): Template {
  return {
    id: `user-container-${slugify(input.displayName || input.imageRef)}`,
    runtime: "container",
    displayName: input.displayName || inferDisplayName(input.imageRef),
    vendor: input.vendor?.trim() || inferVendor(input.imageRef),
    deviceRoleIcon: "host",
    boot: {
      console: "serial",
      acceleration: "n/a",
    },
    configSchema: {
      ramMb: { default: 512, min: 128, max: 8192 },
      vcpu: { default: 1, min: 1, max: 4 },
      interfaceCount: { default: 1, min: 1, max: 8 },
    },
    container: {
      imageRef: input.imageRef,
      registry: input.registry,
      engine: input.engine,
      defaultShell: input.shell?.trim() || "sh",
    },
  };
}

export const containerRoutes: FastifyPluginAsync<AppDependencies> = async (
  app,
  options,
) => {
  const runCommand = options.runtime?.runCommand ?? defaultRunCommand;
  const hasBinary = options.runtime?.hasBinary ?? defaultHasBinary;
  const fetcher = options.runtime?.fetcher;

  async function resolveEngine() {
    return detectContainerEngine(hasBinary, runCommand);
  }

  app.get("/containers/runtime", async (_request, reply) => {
    const engine = await resolveEngine();
    if (!engine) {
      return reply.send({
        engine: null,
        available: false,
        message:
          "No supported container runtime found. Install podman or docker.",
      });
    }

    return reply.send({ engine, available: true, message: null });
  });

  app.get("/containers/images", async (_request, reply) => {
    const engine = await resolveEngine();
    if (!engine) {
      return reply.send({
        engine: null,
        images: [],
        message:
          "No supported container runtime found. Install podman or docker.",
      });
    }

    return reply.send({
      engine,
      images: await listLocalContainerImages(engine, runCommand),
      message: null,
    });
  });

  app.get("/containers/search", async (request) => {
    const query = z
      .object({
        registry: z.string().trim().min(1).default("docker-hub"),
        query: z.string().trim().min(1),
      })
      .parse(request.query);

    const results = await searchContainerImages({
      registry: query.registry,
      query: query.query,
      fetcher,
    });

    return { registry: query.registry, results };
  });

  app.post("/containers/pull", async (request, reply) => {
    const body = z
      .object({
        registry: z.string().trim().min(1).default("docker-hub"),
        imageRef: z.string().trim().min(1),
      })
      .parse(request.body);

    const engine = await resolveEngine();
    if (!engine) {
      return reply
        .code(503)
        .send({ message: "No supported container runtime found." });
    }

    await pullContainerImage(engine, body.imageRef, runCommand);
    const localImages = await listLocalContainerImages(engine, runCommand);
    const image =
      localImages.find((entry) => entry.imageRef === body.imageRef) ??
      localImages.find((entry) => entry.repository === body.imageRef) ??
      null;

    return reply.send({
      engine,
      imageRef: body.imageRef,
      image,
    });
  });

  app.post("/containers/templates", async (request, reply) => {
    const body = z
      .object({
        displayName: z.string().trim().min(1).optional(),
        vendor: z.string().trim().min(1).optional(),
        imageRef: z.string().trim().min(1),
        registry: z.string().trim().min(1).default("docker-hub"),
        engine: z.enum(["docker", "podman"]).optional(),
        shell: z.string().trim().min(1).optional(),
      })
      .parse(request.body);

    const engine = body.engine ?? (await resolveEngine()) ?? "docker";
    const template = saveUserContainerTemplate(
      buildUserContainerTemplate({
        displayName: body.displayName ?? inferDisplayName(body.imageRef),
        vendor: body.vendor,
        imageRef: body.imageRef,
        registry: body.registry,
        engine,
        shell: body.shell,
      }),
    );

    return reply.code(201).send({ template });
  });
};
