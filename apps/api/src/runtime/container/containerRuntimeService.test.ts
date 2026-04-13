import { describe, expect, it, vi } from "vitest";

import {
  detectContainerEngine,
  listLocalContainerImages,
  pullContainerImage,
  searchContainerImages,
} from "./containerRuntimeService.js";

describe("containerRuntimeService", () => {
  it("prefers podman when both runtimes are installed", async () => {
    const hasBinary = vi.fn(async (command: string) =>
      ["podman", "docker"].includes(command),
    );

    await expect(detectContainerEngine(hasBinary)).resolves.toBe("podman");
  });

  it("falls back to docker when podman is unavailable", async () => {
    const hasBinary = vi.fn(async (command: string) => command === "docker");

    await expect(detectContainerEngine(hasBinary)).resolves.toBe("docker");
  });

  it("lists local images from the detected runtime", async () => {
    const runCommand = vi.fn(async () => ({
      ok: true,
      stdout: [
        JSON.stringify({
          Repository: "docker.io/library/oraclelinux",
          Tag: "9-slim",
          ID: "sha256:abc123",
          Size: "72MB",
        }),
        JSON.stringify({
          Repository: "docker.io/library/alpine",
          Tag: "latest",
          ID: "sha256:def456",
          Size: "7MB",
        }),
      ].join("\n"),
      stderr: "",
    }));

    await expect(
      listLocalContainerImages("podman", runCommand),
    ).resolves.toEqual([
      {
        id: "sha256:abc123",
        imageRef: "docker.io/library/oraclelinux:9-slim",
        repository: "docker.io/library/oraclelinux",
        tag: "9-slim",
        size: "72MB",
      },
      {
        id: "sha256:def456",
        imageRef: "docker.io/library/alpine:latest",
        repository: "docker.io/library/alpine",
        tag: "latest",
        size: "7MB",
      },
    ]);
    expect(runCommand).toHaveBeenCalledWith("podman", [
      "image",
      "ls",
      "--format",
      "{{json .}}",
    ]);
  });

  it("pulls a direct image reference through the detected runtime", async () => {
    const runCommand = vi.fn(async () => ({
      ok: true,
      stdout: "",
      stderr: "",
    }));

    await expect(
      pullContainerImage("docker", "oraclelinux:9-slim", runCommand),
    ).resolves.toEqual({ ok: true, imageRef: "oraclelinux:9-slim" });
    expect(runCommand).toHaveBeenCalledWith("docker", [
      "pull",
      "oraclelinux:9-slim",
    ]);
  });

  it("searches Docker Hub by default", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("hub.docker.com");
      expect(String(input)).toContain("oraclelinux");
      return new Response(
        JSON.stringify({
          results: [
            {
              repo_name: "library/oraclelinux",
              short_description: "Oracle Linux base image",
              star_count: 42,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await expect(
      searchContainerImages({
        registry: "docker-hub",
        query: "oraclelinux:9-slim",
        fetcher,
      }),
    ).resolves.toEqual([
      {
        registry: "docker-hub",
        imageRef: "library/oraclelinux:9-slim",
        repository: "library/oraclelinux",
        description: "Oracle Linux base image",
        stars: 42,
      },
    ]);
  });
});
