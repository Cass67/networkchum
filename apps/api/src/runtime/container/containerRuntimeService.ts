import { searchDockerHub } from "./dockerHubRegistry.js";

export type ContainerEngine = "docker" | "podman";

type HasBinary = (command: string) => Promise<boolean>;
type RunCommand = (
  command: string,
  args: string[],
) => Promise<{ ok: boolean; stdout: string; stderr: string }>;

export type LocalContainerImage = {
  id: string;
  imageRef: string;
  repository: string;
  tag: string;
  size?: string;
};

export type ContainerSearchResult = {
  registry: string;
  imageRef: string;
  repository: string;
  description?: string;
  stars?: number;
};

export async function detectContainerEngine(
  hasBinary: HasBinary,
): Promise<ContainerEngine | null> {
  if (await hasBinary("podman")) {
    return "podman";
  }
  if (await hasBinary("docker")) {
    return "docker";
  }
  return null;
}

export async function listLocalContainerImages(
  engine: ContainerEngine,
  runCommand: RunCommand,
): Promise<LocalContainerImage[]> {
  const result = await runCommand(engine, [
    "image",
    "ls",
    "--format",
    "{{json .}}",
  ]);
  if (!result.ok) {
    throw new Error(result.stderr.trim() || "Failed to list container images");
  }

  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, string>)
    .map((entry) => {
      const repository = entry.Repository || "<none>";
      const tag = entry.Tag || "latest";
      return {
        id: entry.ID || `${repository}:${tag}`,
        imageRef: `${repository}:${tag}`,
        repository,
        tag,
        size: entry.Size,
      };
    })
    .filter((entry) => entry.repository !== "<none>");
}

export async function pullContainerImage(
  engine: ContainerEngine,
  imageRef: string,
  runCommand: RunCommand,
): Promise<{ ok: true; imageRef: string }> {
  const result = await runCommand(engine, ["pull", imageRef]);
  if (!result.ok) {
    throw new Error(result.stderr.trim() || `Failed to pull ${imageRef}`);
  }

  return { ok: true, imageRef };
}

export async function searchContainerImages(input: {
  registry: string;
  query: string;
  fetcher?: typeof fetch;
}): Promise<ContainerSearchResult[]> {
  const query = input.query.trim();
  if (!query) {
    return [];
  }

  if (input.registry !== "docker-hub") {
    return [
      {
        registry: input.registry,
        imageRef: query,
        repository: query.split(":")[0] ?? query,
      },
    ];
  }

  const results = await searchDockerHub(query, input.fetcher);
  const tag = query.includes(":") ? query.split(":").pop() : "latest";

  return results.map((result) => {
    const repository = result.repo_name || query.split(":")[0] || query;
    return {
      registry: "docker-hub",
      imageRef: repository.includes(":") ? repository : `${repository}:${tag}`,
      repository,
      description: result.short_description,
      stars: result.star_count,
    };
  });
}
