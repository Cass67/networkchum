import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { createGunzip } from "node:zlib";

import type { ImageRecord, ImageRepo, RepoPull } from "@networkchum/shared";
import { suggestTemplateId } from "@networkchum/shared";
import JSZip from "jszip";

import type { Fetcher } from "./fetcherTypes.js";
import {
  createRepoListingStrategy,
  DISK_IMAGE_EXTENSIONS,
  type RepoFileEntry,
  type RepoListingStrategy,
} from "./repoListing.js";
import { listImages, saveImages } from "./imageStore.js";
import { getImagesDir } from "../storagePaths.js";

const execFileAsync = promisify(execFile);

/** Files that could execute code if installed; never downloaded. */
const SKIPPED_EXTENSIONS = [
  ".sh",
  ".py",
  ".pyc",
  ".php",
  ".exe",
  ".bat",
  ".ps1",
];

const ARCHIVE_EXTENSIONS = [".tgz", ".tar.gz", ".tar", ".ova", ".zip", ".gz"];

/** In-memory pull registry, keyed by pull id. */
const pulls = new Map<string, RepoPull>();

export function listRepoPulls(repoId: string): RepoPull[] {
  return [...pulls.values()]
    .filter((pull) => pull.repoId === repoId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getRepoPull(pullId: string): RepoPull | null {
  return pulls.get(pullId) ?? null;
}

export type StartRepoPullInput = {
  repo: ImageRepo;
  entryPath: string;
  fetcher?: Fetcher;
  /** When set, newly registered images are bound to this template. */
  templateId?: string;
};

/**
 * Starts pulling a folder or file from a repo in the background. Progress is
 * tracked in memory; poll GET /image-repos/:repoId/pulls to follow it.
 */
export async function startRepoPull(
  input: StartRepoPullInput,
): Promise<RepoPull> {
  const entryPath = normalizeEntryPath(input.entryPath);
  if (!entryPath || entryPath === "/") {
    throw new Error("Pull path must name a folder or file, not the repo root");
  }

  const record: RepoPull = {
    id: `pull-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    repoId: input.repo.id,
    entryPath,
    templateId: input.templateId ?? null,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    currentFile: null,
    bytesReceived: null,
    totalBytes: null,
    images: [],
    warnings: [],
    error: null,
  };
  pulls.set(record.id, record);

  void runPull(input.repo, entryPath, record, input.fetcher, input.templateId);

  return record;
}

function normalizeEntryPath(entryPath: string): string {
  const normalized = entryPath.startsWith("/") ? entryPath : `/${entryPath}`;
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : "/";
}

async function runPull(
  repo: ImageRepo,
  entryPath: string,
  record: RepoPull,
  fetcher?: Fetcher,
  templateId?: string,
): Promise<void> {
  try {
    const strategy = createRepoListingStrategy(repo, fetcher);
    if (repo.kind === "local") {
      await pullLocal(repo, entryPath, strategy, record);
    } else {
      await pullFromUrl(repo, entryPath, strategy, record, fetcher ?? fetch);
    }
    if (templateId) {
      await bindImagesToTemplate(record, templateId);
    }
    record.status = "done";
    record.finishedAt = new Date().toISOString();
  } catch (error) {
    record.status = "error";
    record.error = error instanceof Error ? error.message : String(error);
    record.finishedAt = new Date().toISOString();
  }
}

/** Binds every image registered by this pull to the chosen template. */
async function bindImagesToTemplate(
  record: RepoPull,
  templateId: string,
): Promise<void> {
  const images = await listImages();
  let changed = false;
  for (const imageId of record.images) {
    const image = images.find((entry) => entry.id === imageId);
    if (!image) {
      continue;
    }
    image.templateId = templateId;
    if (image.catalogState === "removed") {
      image.catalogState = "active";
    }
    changed = true;
  }
  if (changed) {
    await saveImages(images);
  }
}

function isDiskImageFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return DISK_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isArchive(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isSkippedFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return SKIPPED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function createImageId(fileName: string): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileName
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase()}`;
}

function sanitizeTargetName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return sanitized || "image";
}

function sanitizeRelativeTarget(relativePath: string): string {
  return relativePath
    .slice(1) // drop the leading "/"
    .split("/")
    .map((segment) => sanitizeTargetName(segment))
    .filter((segment) => segment !== "..")
    .join("/");
}

function parentDirPath(entryPath: string): string {
  const parent = entryPath.slice(0, entryPath.lastIndexOf("/"));
  return parent === "" ? "/" : parent;
}

async function registerDiskImage(
  absolutePath: string,
  suggestedName: string,
  record: RepoPull,
): Promise<void> {
  const baseName = path.basename(absolutePath);
  if (!baseName.toLowerCase().endsWith(".qcow2")) {
    record.warnings.push(
      `Skipped ${baseName}: only .qcow2 images can be registered`,
    );
    return;
  }

  const images = await listImages();
  const existing = images.find((image) => image.path === absolutePath);
  if (existing) {
    record.images.push(existing.id);
    return;
  }

  let sizeBytes = 0;
  try {
    sizeBytes = (await stat(absolutePath)).size;
  } catch {
    sizeBytes = 0;
  }

  const image: ImageRecord = {
    id: createImageId(baseName),
    name: baseName,
    path: absolutePath,
    format: "qcow2",
    sizeBytes,
    updatedAt: new Date().toISOString(),
    templateId: null,
    suggestedTemplateId:
      suggestTemplateId(baseName) ?? suggestTemplateId(suggestedName) ?? null,
    source: "pull",
    catalogState: "active",
  };
  await saveImages([...images, image]);
  record.images.push(image.id);
}

async function collectFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (entry.isFile()) {
        found.push(entryPath);
      }
    }
  }
  await walk(dir);
  return found;
}

async function pullLocal(
  repo: ImageRepo,
  entryPath: string,
  strategy: RepoListingStrategy,
  record: RepoPull,
): Promise<void> {
  const repoRoot = path.resolve(repo.path ?? "");
  const absoluteTarget = path.resolve(repoRoot, entryPath.slice(1));
  if (!absoluteTarget.startsWith(repoRoot)) {
    throw new Error("Pull path is outside the repo root");
  }

  let targetStat;
  try {
    targetStat = await stat(absoluteTarget);
  } catch {
    throw new Error(`Pull path does not exist: ${entryPath}`);
  }

  const folderName = entryPath.split("/").at(-1) ?? entryPath;
  if (targetStat.isFile()) {
    if (!isDiskImageFile(path.basename(absoluteTarget))) {
      throw new Error(`Pull path is not a disk image: ${entryPath}`);
    }
    await registerDiskImage(absoluteTarget, folderName, record);
    return;
  }

  const files = await strategy.listFolderFiles(entryPath);
  for (const file of files) {
    await registerDiskImage(
      path.resolve(repoRoot, file.path.slice(1)),
      folderName,
      record,
    );
  }
}

async function pullFromUrl(
  repo: ImageRepo,
  entryPath: string,
  strategy: RepoListingStrategy,
  record: RepoPull,
  fetchFn: Fetcher,
): Promise<void> {
  const listing = await strategy.list(parentDirPath(entryPath));
  const isFolder = listing.folders.some((folder) => folder.path === entryPath);

  // Pulled content lands under data/images/repos/<repoId>/<entryName>/
  // (archives keep any subdirectories they carry inside the archive).
  const entryName = entryPath.split("/").at(-1) ?? "image";
  const targetDir = path.join(
    getImagesDir(),
    "repos",
    repo.id,
    sanitizeTargetName(entryName.replace(/\.[a-z0-9]+$/i, "")),
  );
  await mkdir(targetDir, { recursive: true });

  const files: RepoFileEntry[] = isFolder
    ? await strategy.listFolderFiles(entryPath)
    : await findSingleFileEntry(strategy, entryPath);

  if (files.length === 0) {
    throw new Error(`Nothing to pull from ${entryPath}`);
  }

  const prefixToStrip = isFolder
    ? `${entryPath}/`
    : `${parentDirPath(entryPath)}/`;

  // Expected download size for the progress bar (url repos only).
  const totalBytes = files.reduce(
    (sum, file) => sum + (file.sizeBytes ?? 0),
    0,
  );
  record.totalBytes = totalBytes > 0 ? totalBytes : null;

  let totalReceived = 0;
  for (const file of files) {
    if (isSkippedFile(file.path)) {
      record.warnings.push(
        `Skipped ${file.path}: executable files are never downloaded from repos`,
      );
      continue;
    }
    const relativeInsideEntry = file.path.startsWith(prefixToStrip)
      ? `/${file.path.slice(prefixToStrip.length)}`
      : file.path;
    const targetPath = path.join(
      targetDir,
      sanitizeRelativeTarget(relativeInsideEntry),
    );
    await mkdir(path.dirname(targetPath), { recursive: true });

    if (await canSkipDownload(targetPath, file.sizeBytes)) {
      record.warnings.push(`Reused existing download for ${file.path}`);
      totalReceived += file.sizeBytes ?? 0;
      continue;
    }

    record.currentFile = file.path;
    const baseline = totalReceived;
    const { received, md5, sha1 } = await downloadFile(
      file.url,
      targetPath,
      fetchFn,
      (bytes) => {
        record.bytesReceived = baseline + bytes;
      },
    );
    totalReceived += received;
    record.bytesReceived = totalReceived;

    if (file.sizeBytes != null && received !== file.sizeBytes) {
      await rm(targetPath, { force: true });
      throw new Error(
        `Downloaded ${file.path} has size ${received}, expected ${file.sizeBytes}`,
      );
    }
    if (file.checksumMd5 && file.checksumMd5 !== md5) {
      await rm(targetPath, { force: true });
      throw new Error(`MD5 mismatch for ${file.path}`);
    }
    if (file.checksumSha1 && file.checksumSha1 !== sha1) {
      await rm(targetPath, { force: true });
      throw new Error(`SHA1 mismatch for ${file.path}`);
    }
  }

  record.currentFile = null;

  // Extract archives in place; the resulting disk images get registered.
  for (const archivePath of (await collectFiles(targetDir)).filter((file) =>
    isArchive(path.basename(file)),
  )) {
    const warning = await extractArchive(
      archivePath,
      path.dirname(archivePath),
    );
    if (warning) {
      record.warnings.push(warning);
      continue;
    }
    await rm(archivePath, { force: true });
  }

  const folderName = entryPath.split("/").at(-1) ?? entryPath;
  const diskFiles = (await collectFiles(targetDir)).filter((file) =>
    isDiskImageFile(path.basename(file)),
  );
  if (diskFiles.length === 0) {
    throw new Error(`No usable disk image found in ${entryPath}`);
  }

  for (const diskFile of diskFiles) {
    await registerDiskImage(diskFile, folderName, record);
  }
}

async function findSingleFileEntry(
  strategy: RepoListingStrategy,
  entryPath: string,
): Promise<RepoFileEntry[]> {
  const listing = await strategy.list(parentDirPath(entryPath));
  const file = listing.files.find((entry) => entry.path === entryPath);
  if (!file) {
    throw new Error(`Pull path not found in repo: ${entryPath}`);
  }
  if (!file.url) {
    throw new Error(`No download URL available for ${entryPath}`);
  }
  return [
    {
      path: file.path,
      url: file.url,
      sizeBytes: file.sizeBytes,
      checksumMd5: file.checksumMd5 ?? null,
      checksumSha1: file.checksumSha1 ?? null,
    },
  ];
}

async function canSkipDownload(
  targetPath: string,
  expectedSize: number | null,
): Promise<boolean> {
  if (expectedSize == null) {
    return false;
  }
  try {
    return (await stat(targetPath)).size === expectedSize;
  } catch {
    return false;
  }
}

type DownloadResult = {
  received: number;
  md5: string;
  sha1: string;
};

async function downloadFile(
  url: string | null,
  targetPath: string,
  fetchFn: Fetcher,
  onProgress: (bytes: number) => void,
): Promise<DownloadResult> {
  if (!url) {
    throw new Error(`No download URL available for ${targetPath}`);
  }

  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const md5Hash = createHash("md5");
  const sha1Hash = createHash("sha1");
  let received = 0;

  const body = response.body;
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    received = buffer.byteLength;
    md5Hash.update(buffer);
    sha1Hash.update(buffer);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, buffer);
    onProgress(received);
    return {
      received,
      md5: md5Hash.digest("hex"),
      sha1: sha1Hash.digest("hex"),
    };
  }

  const target = createWriteStream(targetPath);
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      md5Hash.update(chunk);
      sha1Hash.update(chunk);
      onProgress(received);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(body as unknown as NodeWebReadableStream),
    counter,
    target,
  );

  return {
    received,
    md5: md5Hash.digest("hex"),
    sha1: sha1Hash.digest("hex"),
  };
}

async function extractArchive(
  archivePath: string,
  targetDir: string,
): Promise<string | undefined> {
  const lower = archivePath.toLowerCase();
  try {
    if (lower.endsWith(".zip")) {
      const zip = await JSZip.loadAsync(await readFile(archivePath));
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) {
          continue;
        }
        const entryPath = path.resolve(targetDir, entry.name);
        if (!entryPath.startsWith(targetDir)) {
          return `Skipped zip entry ${entry.name}: path traversal`;
        }
        const buffer = await entry.async("nodebuffer");
        await mkdir(path.dirname(entryPath), { recursive: true });
        await writeFile(entryPath, buffer);
      }
      return undefined;
    }

    if (
      lower.endsWith(".gz") &&
      !lower.endsWith(".tgz") &&
      !lower.endsWith(".tar.gz")
    ) {
      // Single-file gzip, e.g. hda.qcow2.gz.
      const decompressed = path.join(
        path.dirname(archivePath),
        path.basename(archivePath).replace(/\.gz$/i, ""),
      );
      const gunzip = createGunzip();
      const source = createReadStream(archivePath);
      const target = createWriteStream(decompressed);
      await pipeline(source, gunzip, target);
      return undefined;
    }

    // tar-compatible archives: .tgz, .tar.gz, .tar, .ova
    await execFileAsync("tar", ["-xf", archivePath, "-C", targetDir]);
    return undefined;
  } catch (error) {
    return `Failed to extract ${path.basename(archivePath)}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}
