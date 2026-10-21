import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ImageRepo, RepoEntry, RepoListing } from "@networkchum/shared";

import type { Fetcher } from "./fetcherTypes.js";
import { createIshare2IndexClient } from "./ishare2Index.js";
import { parseHtmlDirectoryListing } from "./htmlListing.js";

export const DISK_IMAGE_EXTENSIONS = [
  ".qcow2",
  ".img",
  ".raw",
  ".vmdk",
  ".iso",
];

export type RepoFileEntry = {
  /** Repo-relative path of the file, starting with "/". */
  path: string;
  url: string | null;
  sizeBytes: number | null;
  checksumMd5: string | null;
  checksumSha1: string | null;
};

/**
 * A listing strategy for one repo. `list` returns the folders and disk-image
 * files directly under one repo-relative directory; `listFolderFiles` returns
 * every disk-image file under a repo-relative folder, recursively.
 */
export type RepoListingStrategy = {
  list(dirPath: string): Promise<RepoListing>;
  listFolderFiles(folderPath: string): Promise<RepoFileEntry[]>;
};

function isDiskImage(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return DISK_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function normalizeDirPath(dirPath: string): string {
  const normalized = dirPath.startsWith("/") ? dirPath : `/${dirPath}`;
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : "/";
}

function joinDirPath(dirPath: string, name: string): string {
  return `${dirPath === "/" ? "" : dirPath}/${name}`;
}

function toEntry(
  name: string,
  entryPath: string,
  kind: "folder" | "file",
  url: string | null,
  sizeBytes: number | null,
  checksumMd5?: string | null,
  checksumSha1?: string | null,
): RepoEntry {
  return {
    name,
    path: entryPath,
    kind,
    url,
    sizeBytes,
    checksumMd5: checksumMd5 ?? null,
    checksumSha1: checksumSha1 ?? null,
  };
}

/**
 * Builds a directory listing from repo-relative file paths (without a
 * leading "/") that carry their download URL and size. Files deeper than one
 * level below the listed directory collapse into folder entries.
 */
function buildDirectoryListing(
  repoId: string,
  dirPath: string,
  entries: Array<{
    relative: string;
    url: string | null;
    sizeBytes: number | null;
    checksumMd5?: string | null;
    checksumSha1?: string | null;
  }>,
): { folders: RepoEntry[]; files: RepoEntry[] } {
  // Repo-relative prefix of the listed directory, without leading "/" and
  // with trailing "/", e.g. dirPath "/Linux" → "Linux/".
  const listPrefix = dirPath === "/" ? "" : `${dirPath.slice(1)}/`;
  const folders = new Map<string, { size: number }>();
  const files: RepoEntry[] = [];

  for (const entry of entries) {
    const rest = entry.relative.startsWith(listPrefix)
      ? entry.relative.slice(listPrefix.length)
      : null;
    if (!rest) {
      continue;
    }
    const firstSegment = rest.split("/")[0] ?? "";
    if (!firstSegment) {
      continue;
    }
    if (rest.includes("/")) {
      const entryPath = joinDirPath(dirPath, firstSegment);
      const current = folders.get(entryPath) ?? { size: 0 };
      current.size += entry.sizeBytes ?? 0;
      folders.set(entryPath, current);
      continue;
    }
    files.push(
      toEntry(
        firstSegment,
        joinDirPath(dirPath, firstSegment),
        "file",
        entry.url,
        entry.sizeBytes,
        entry.checksumMd5,
        entry.checksumSha1,
      ),
    );
  }

  const folderEntries = [...folders.entries()].map(([entryPath, total]) =>
    toEntry(
      entryPath.split("/").at(-1) ?? entryPath,
      entryPath,
      "folder",
      null,
      total.size,
    ),
  );
  return { folders: folderEntries, files };
}

/** Local directory repo: browse in place, nothing is copied. */
function createLocalStrategy(repo: ImageRepo): RepoListingStrategy {
  const repoRoot = path.resolve(repo.path ?? "");

  function resolveDir(dirPath: string): string {
    const target = path.resolve(repoRoot, dirPath.slice(1));
    if (!target.startsWith(repoRoot)) {
      throw new Error("Directory is outside the repo root");
    }
    return target;
  }

  return {
    async list(dirPath) {
      const normalized = normalizeDirPath(dirPath);
      const targetDir = resolveDir(normalized);
      const dirEntries = await readdir(targetDir, {
        withFileTypes: true,
        recursive: false,
      });

      const folders: RepoEntry[] = [];
      const files: RepoEntry[] = [];
      for (const entry of dirEntries) {
        if (entry.name.startsWith(".")) {
          continue;
        }
        if (entry.isDirectory()) {
          folders.push(
            toEntry(
              entry.name,
              joinDirPath(normalized, entry.name),
              "folder",
              null,
              null,
            ),
          );
          continue;
        }
        if (!entry.isFile() || !isDiskImage(entry.name)) {
          continue;
        }
        let sizeBytes: number | null = null;
        try {
          sizeBytes = (await stat(path.join(targetDir, entry.name))).size;
        } catch {
          sizeBytes = null;
        }
        files.push(
          toEntry(
            entry.name,
            joinDirPath(normalized, entry.name),
            "file",
            null,
            sizeBytes,
          ),
        );
      }

      return { repoId: repo.id, path: normalized, folders, files };
    },

    async listFolderFiles(folderPath) {
      const targetDir = resolveDir(normalizeDirPath(folderPath));
      const files: RepoFileEntry[] = [];

      async function walk(current: string, relativePrefix: string) {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(current, entry.name);
          const relativePath = `${relativePrefix}${entry.name}`;
          if (entry.isDirectory()) {
            await walk(entryPath, `${relativePath}/`);
            continue;
          }
          if (!entry.isFile() || !isDiskImage(entry.name)) {
            continue;
          }
          let sizeBytes: number | null = null;
          try {
            sizeBytes = (await stat(entryPath)).size;
          } catch {
            sizeBytes = null;
          }
          files.push({
            path: `/${relativePath.split(path.sep).join("/")}`,
            url: null,
            sizeBytes,
            checksumMd5: null,
            checksumSha1: null,
          });
        }
      }

      await walk(targetDir, `${normalizeDirPath(folderPath).slice(1)}/`);
      return files;
    },
  };
}

/** URL repo: auto-detect ishare2 shares, JSON manifests, and HTML listings. */
function createUrlStrategy(
  repo: ImageRepo,
  fetchFn: Fetcher,
): RepoListingStrategy {
  const repoUrl = new URL(repo.url ?? "");
  const ishare2Share = matchIshare2ShareUrl(repoUrl);

  // ishare2-compatible share (https://<host>/0:<path>/, e.g. LabHub): the
  // published ishare2 index provides a full recursive listing with checksums.
  if (ishare2Share) {
    return createIshare2Strategy(repo, repoUrl, ishare2Share, fetchFn);
  }

  // A JSON manifest/index: entries are described inline.
  if (repoUrl.pathname.toLowerCase().endsWith(".json")) {
    return createManifestStrategy(repo, repoUrl, fetchFn);
  }

  // Fallback: HTML directory listing (nginx/Apache style), crawled on demand.
  return createHtmlStrategy(repo, fetchFn);
}

type Ishare2Share = {
  /** e.g. "/0:" — the share/drive prefix inside the URL. */
  sharePrefix: string;
  /** e.g. "/addons/qemu/" — decoded path inside the share; the repo root. */
  sharePathPrefix: string;
};

function matchIshare2ShareUrl(url: URL): Ishare2Share | null {
  // "0:" is the drive label ishare2-style shares use in their URLs.
  const segments = url.pathname.split("/");
  const driveIndex = segments.findIndex((seg) => seg.endsWith(":"));
  if (driveIndex === -1) {
    return null;
  }
  const sharePrefix = `/${segments[driveIndex]}`;
  const afterDrive = segments.slice(driveIndex + 1).join("/");
  const sharePathPrefix = decodeURIComponent(
    afterDrive.endsWith("/") ? afterDrive : `${afterDrive}/`,
  );
  return {
    sharePrefix,
    // Ensure a leading "/" — segments[0] is "" for absolute paths, so
    // afterDrive itself has none.
    sharePathPrefix: sharePathPrefix.startsWith("/")
      ? sharePathPrefix
      : `/${sharePathPrefix}`,
  };
}

type IndexImageFiles = Ishare2Index["images"][number]["files"];

type Ishare2Index = {
  /** Download base, e.g. "https://labhub.eu.org/0:" — append encoded paths. */
  urlBase: string;
  images: Array<{
    name: string;
    files: Array<{
      /** Share-absolute, URL-encoded path starting with "/". */
      path: string;
      size?: number;
      checksum?: { md5?: string; sha1?: string };
    }>;
  }>;
};

/**
 * Strategy over an ishare2-style index (labhub.eu.org and friends). Index
 * file paths are share-absolute and URL-encoded; the share path prefix maps
 * them to repo-relative paths.
 */
function createIshare2Strategy(
  repo: ImageRepo,
  repoUrl: URL,
  share: Ishare2Share,
  fetchFn: Fetcher,
): RepoListingStrategy {
  const indexClient = createIshare2IndexClient(fetchFn);
  // e.g. "/addons/qemu" → "qemu"; picks the matching index asset.
  const domain = share.sharePathPrefix.split("/").filter(Boolean)[0] ?? "qemu";
  const repoRootPrefix = share.sharePathPrefix.replace(/\/$/, "");
  // Derive the download base from the repo URL itself so mirrors
  // (drive.labhub.eu.org etc.) keep working: origin + share prefix.
  const urlBase = `${repoUrl.origin}${share.sharePrefix}`;

  function toRelative(decodedSharePath: string): string | null {
    if (!decodedSharePath.startsWith(`${repoRootPrefix}/`)) {
      return null;
    }
    return decodedSharePath.slice(repoRootPrefix.length + 1);
  }

  function toFileEntries(
    images: Ishare2Index["images"],
    dirPath: string,
  ): { folders: RepoEntry[]; files: RepoEntry[] } {
    const entries = collectRelativeEntries(images, toRelative, urlBase);
    return buildDirectoryListing(repo.id, dirPath, entries);
  }

  return {
    async list(dirPath) {
      const normalized = normalizeDirPath(dirPath);
      const index = await indexClient.getIndexForPrefix(domain);
      return {
        repoId: repo.id,
        path: normalized,
        ...toFileEntries(index.images, normalized),
      };
    },

    async listFolderFiles(folderPath) {
      const index = await indexClient.getIndexForPrefix(domain);
      const normalized = normalizeDirPath(folderPath);
      const folderPrefix = normalized === "/" ? "" : normalized.slice(1);
      const entries = collectRelativeEntries(index.images, toRelative, urlBase);
      return entries
        .filter((entry) => entry.relative.startsWith(`${folderPrefix}/`))
        .map((entry) => ({
          path: `/${entry.relative}`,
          url: entry.url,
          sizeBytes: entry.sizeBytes,
          checksumMd5: entry.checksumMd5 ?? null,
          checksumSha1: entry.checksumSha1 ?? null,
        }));
    },
  };
}

/** JSON manifest repo: an ishare2-style index hosted anywhere. */
function createManifestStrategy(
  repo: ImageRepo,
  manifestUrl: URL,
  fetchFn: Fetcher,
): RepoListingStrategy {
  async function load(): Promise<Ishare2Index> {
    const response = await fetchFn(manifestUrl.toString());
    if (!response.ok) {
      throw new Error(
        `Failed to fetch manifest ${manifestUrl}: ${response.status}`,
      );
    }
    const manifest = (await response.json()) as unknown;
    const images = parseManifestImages(manifest);
    if (!images) {
      throw new Error(
        "Manifest does not look like an ishare2-style index (missing images[])",
      );
    }
    return { urlBase: deriveManifestUrlBase(manifestUrl, manifest), images };
  }

  // Manifest file paths are share-absolute; the repo root is the drive root.
  function toRelative(decodedPath: string): string | null {
    return decodedPath.replace(/^\/+/, "");
  }

  return {
    async list(dirPath) {
      const normalized = normalizeDirPath(dirPath);
      const { urlBase, images } = await load();
      const entries = collectRelativeEntries(images, toRelative, urlBase);
      return {
        repoId: repo.id,
        path: normalized,
        ...buildDirectoryListing(repo.id, normalized, entries),
      };
    },

    async listFolderFiles(folderPath) {
      const { urlBase, images } = await load();
      const normalized = normalizeDirPath(folderPath);
      const folderPrefix = normalized === "/" ? "" : normalized.slice(1);
      const entries = collectRelativeEntries(images, toRelative, urlBase);
      return entries
        .filter((entry) => entry.relative.startsWith(`${folderPrefix}/`))
        .map((entry) => ({
          path: `/${entry.relative}`,
          url: entry.url,
          sizeBytes: entry.sizeBytes,
          checksumMd5: entry.checksumMd5 ?? null,
          checksumSha1: entry.checksumSha1 ?? null,
        }));
    },
  };
}

function collectRelativeEntries(
  images: Ishare2Index["images"],
  toRelative: (decodedSharePath: string) => string | null,
  urlBase: string,
): Array<{
  relative: string;
  url: string | null;
  sizeBytes: number | null;
  checksumMd5?: string | null;
  checksumSha1?: string | null;
}> {
  const entries: Array<{
    relative: string;
    url: string | null;
    sizeBytes: number | null;
    checksumMd5?: string | null;
    checksumSha1?: string | null;
  }> = [];
  for (const image of images) {
    for (const file of image.files) {
      const decodedPath = decodeURIComponent(file.path);
      const relative = toRelative(decodedPath);
      if (!relative) {
        continue;
      }
      entries.push({
        relative,
        url: `${urlBase}${file.path}`,
        sizeBytes: file.size ?? null,
        checksumMd5: file.checksum?.md5 || null,
        checksumSha1: file.checksum?.sha1 || null,
      });
    }
  }
  return entries;
}

/** Generic HTML directory listing repo (nginx/Apache autoindex). */
function createHtmlStrategy(
  repo: ImageRepo,
  fetchFn: Fetcher,
): RepoListingStrategy {
  const baseUrl = new URL(repo.url ?? "");

  async function listDirectory(dirPath: string): Promise<RepoListing> {
    const dirUrl = new URL(
      `${baseUrl.pathname.replace(/\/+$/, "")}${
        dirPath === "/" ? "/" : `${dirPath}/`
      }`,
      baseUrl,
    );
    const response = await fetchFn(dirUrl.toString());
    if (!response.ok) {
      throw new Error(
        `Failed to fetch directory listing ${dirUrl}: ${response.status}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const looksLikeHtml =
      /text\/html/i.test(contentType) || /<html|<body|<a\s/i.test(body);
    if (!looksLikeHtml) {
      throw new Error(
        `URL does not serve an HTML directory listing (${
          contentType || "unknown content type"
        })`,
      );
    }

    const links = parseHtmlDirectoryListing(body);
    if (!links) {
      throw new Error(
        "No directory entries found. The URL may be a JavaScript-rendered " +
          "share — point the repo at a plain listing, a JSON manifest, or an " +
          "ishare2-style share instead.",
      );
    }

    const folders: RepoEntry[] = [];
    const files: RepoEntry[] = [];
    for (const link of links) {
      if (link.href.endsWith("/")) {
        const name = decodeURIComponent(
          link.href.replace(/\/+$/, "").split("/").at(-1) ?? "",
        );
        if (!name || name === ".." || name.startsWith(".")) {
          continue;
        }
        folders.push(
          toEntry(name, joinDirPath(dirPath, name), "folder", null, null),
        );
        continue;
      }
      const fileName = decodeURIComponent(link.href.split("/").at(-1) ?? "");
      if (!fileName || fileName.startsWith(".") || !isDiskImage(fileName)) {
        continue;
      }
      files.push(
        toEntry(
          fileName,
          joinDirPath(dirPath, fileName),
          "file",
          new URL(link.href, dirUrl).toString(),
          null,
        ),
      );
    }

    return { repoId: repo.id, path: dirPath, folders, files };
  }

  return {
    async list(dirPath) {
      return listDirectory(normalizeDirPath(dirPath));
    },

    async listFolderFiles(folderPath) {
      // Crawl the folder breadth-first, collecting disk-image files.
      const files: RepoFileEntry[] = [];
      const queue = [normalizeDirPath(folderPath)];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const dirPath = queue.shift()!;
        if (seen.has(dirPath)) {
          continue;
        }
        seen.add(dirPath);
        const listing = await listDirectory(dirPath);
        for (const folder of listing.folders) {
          queue.push(folder.path);
        }
        for (const file of listing.files) {
          if (!file.url) {
            continue;
          }
          files.push({
            path: file.path,
            url: file.url,
            sizeBytes: file.sizeBytes,
            checksumMd5: file.checksumMd5 ?? null,
            checksumSha1: file.checksumSha1 ?? null,
          });
        }
      }
      return files;
    },
  };
}

function parseManifestImages(manifest: unknown): Ishare2Index["images"] | null {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !Array.isArray((manifest as { images?: unknown }).images)
  ) {
    return null;
  }
  const parsed: Ishare2Index["images"] = [];
  for (const image of (manifest as { images: unknown[] }).images) {
    if (
      !image ||
      typeof image !== "object" ||
      !Array.isArray((image as { files?: unknown }).files)
    ) {
      continue;
    }
    const name = String((image as { name?: unknown }).name ?? "image");
    const files: IndexImageFiles = [];
    for (const file of (image as { files: unknown[] }).files) {
      if (!file || typeof file !== "object") {
        continue;
      }
      const filePath = (file as { path?: unknown }).path;
      if (typeof filePath !== "string" || !filePath.startsWith("/")) {
        continue;
      }
      const checksum = (file as { checksum?: unknown }).checksum;
      files.push({
        path: filePath,
        size:
          typeof (file as { size?: unknown }).size === "number"
            ? (file as { size: number }).size
            : undefined,
        checksum:
          checksum && typeof checksum === "object"
            ? {
                md5:
                  typeof (checksum as { md5?: unknown }).md5 === "string"
                    ? (checksum as { md5: string }).md5
                    : undefined,
                sha1:
                  typeof (checksum as { sha1?: unknown }).sha1 === "string"
                    ? (checksum as { sha1: string }).sha1
                    : undefined,
              }
            : undefined,
      });
    }
    parsed.push({ name, files });
  }
  return parsed;
}

function deriveManifestUrlBase(manifestUrl: URL, manifest: unknown): string {
  const urlProperties = (manifest as { url_properties?: unknown })
    .url_properties;
  if (urlProperties && typeof urlProperties === "object") {
    const { protocol, hostnames, prefixes } = urlProperties as {
      protocol?: unknown;
      hostnames?: unknown;
      prefixes?: unknown;
    };
    const hostname =
      hostnames && typeof hostnames === "object"
        ? (hostnames as Record<string, unknown>).main
        : undefined;
    const prefix =
      prefixes && typeof prefixes === "object"
        ? (prefixes as Record<string, unknown>).main
        : undefined;
    if (
      typeof protocol === "string" &&
      typeof hostname === "string" &&
      typeof prefix === "string"
    ) {
      return `${protocol}://${hostname}${prefix}`;
    }
  }
  // Fall back to the manifest's own directory.
  const dir = path.dirname(manifestUrl.pathname);
  return `${manifestUrl.origin}${dir === "/" ? "" : dir}`;
}

export function createRepoListingStrategy(
  repo: ImageRepo,
  fetcher?: Fetcher,
): RepoListingStrategy {
  if (repo.kind === "local") {
    return createLocalStrategy(repo);
  }
  return createUrlStrategy(repo, fetcher ?? fetch);
}

export async function listRepoEntries(input: {
  repo: ImageRepo;
  dirPath?: string;
  fetcher?: Fetcher;
}): Promise<RepoListing> {
  const strategy = createRepoListingStrategy(input.repo, input.fetcher);
  return strategy.list(normalizeDirPath(input.dirPath ?? "/"));
}

export async function listRepoFolderFiles(input: {
  repo: ImageRepo;
  folderPath: string;
  fetcher?: Fetcher;
}): Promise<RepoFileEntry[]> {
  const strategy = createRepoListingStrategy(input.repo, input.fetcher);
  return strategy.listFolderFiles(normalizeDirPath(input.folderPath));
}
