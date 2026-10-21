import type { Fetcher } from "./fetcherTypes.js";

const INDEX_RELEASES_API =
  "https://api.github.com/repos/ishare2-org/mirrors/releases/latest";
const CACHE_TTL_MS = 60 * 60 * 1000;

type ReleaseResponse = {
  assets?: Array<{ name?: string; browser_download_url?: string }>;
};

type Ishare2IndexImages = Array<{
  name: string;
  files: Array<{
    path: string;
    size?: number;
    checksum?: { md5?: string; sha1?: string };
  }>;
}>;

type CachedIndex = { images: Ishare2IndexImages; fetchedAt: number };

/**
 * Fetches and caches ishare2 image indexes (labhub.eu.org and friends). The
 * indexes are published as release assets of ishare2-org/mirrors: qemu.json,
 * dynamips.json, iol.json — one per image domain. File paths inside the index
 * are share-absolute and URL-encoded.
 */
export function createIshare2IndexClient(fetcher: Fetcher) {
  const cache = new Map<string, CachedIndex>();

  async function getIndexForPrefix(domain: string): Promise<{
    images: Ishare2IndexImages;
  }> {
    const cacheKey = domain || "qemu";
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return { images: cached.images };
    }

    const releaseResponse = await fetcher(INDEX_RELEASES_API, {
      headers: { accept: "application/vnd.github+json" },
    });
    if (!releaseResponse.ok) {
      throw new Error(
        `Failed to fetch ishare2 index release info: ${releaseResponse.status}`,
      );
    }
    const release = (await releaseResponse.json()) as ReleaseResponse;
    const wanted = `${cacheKey}.json`;
    const asset =
      (release.assets ?? []).find((candidate) => candidate.name === wanted) ??
      (release.assets ?? []).find(
        (candidate) => candidate.name === "qemu.json",
      );
    const assetUrl = asset?.browser_download_url;
    if (!assetUrl) {
      throw new Error(`No ishare2 index asset found for "${cacheKey}"`);
    }

    const indexResponse = await fetcher(assetUrl);
    if (!indexResponse.ok) {
      throw new Error(
        `Failed to fetch ishare2 index ${wanted}: ${indexResponse.status}`,
      );
    }
    const index = (await indexResponse.json()) as {
      images?: Ishare2IndexImages;
    };
    const images = Array.isArray(index.images) ? index.images : [];
    if (images.length === 0) {
      throw new Error(`Ishare2 index ${wanted} has no images`);
    }

    cache.set(cacheKey, { images, fetchedAt: Date.now() });
    return { images };
  }

  return { getIndexForPrefix };
}
