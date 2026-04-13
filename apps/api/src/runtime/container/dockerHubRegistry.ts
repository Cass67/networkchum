export type DockerHubSearchResult = {
  repo_name?: string;
  short_description?: string;
  star_count?: number;
};

export async function searchDockerHub(
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<DockerHubSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const repositoryQuery = trimmed.split(":")[0] ?? trimmed;
  const url = new URL("https://hub.docker.com/v2/search/repositories/");
  url.searchParams.set("page_size", "25");
  url.searchParams.set("query", repositoryQuery);

  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Docker Hub search failed with status ${response.status}`);
  }

  const payload = (await response.json()) as {
    results?: DockerHubSearchResult[];
  };
  return payload.results ?? [];
}
