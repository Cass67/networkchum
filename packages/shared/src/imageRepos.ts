import { z } from "zod";

/**
 * An "image repo" is a source of network device disk images: either a
 * directory on the local filesystem or a URL. URL repos can point at a
 * plain directory listing (nginx/Apache style), a JSON index/manifest, or
 * an ishare2-compatible share such as https://labhub.eu.org/0:/addons/qemu/.
 */
export const ImageRepoKindSchema = z.enum(["local", "url"]);

export const ImageRepoSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: ImageRepoKindSchema,
  path: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  addedAt: z.string().min(1),
});

export const RepoEntrySchema = z.object({
  /** Display name (last path segment, trailing slash stripped). */
  name: z.string().min(1),
  /** Path relative to the repo root, starting with "/". */
  path: z.string().min(1),
  kind: z.enum(["folder", "file"]),
  /** Resolved download URL for url repos; null for local repos. */
  url: z.string().min(1).nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  checksumMd5: z.string().nullable().optional(),
  checksumSha1: z.string().nullable().optional(),
});

export const RepoListingSchema = z.object({
  repoId: z.string().min(1),
  /** Directory being listed, relative to the repo root, starting with "/". */
  path: z.string().min(1).default("/"),
  folders: z.array(RepoEntrySchema),
  files: z.array(RepoEntrySchema),
});

export const RepoPullStatusSchema = z.enum(["running", "done", "error"]);

export const RepoPullSchema = z.object({
  id: z.string().min(1),
  repoId: z.string().min(1),
  /** Repo-relative path of the pulled folder or file. */
  entryPath: z.string().min(1),
  /** Optional template the pulled images get bound to after registration. */
  templateId: z.string().nullable(),
  status: RepoPullStatusSchema,
  startedAt: z.string().min(1),
  finishedAt: z.string().nullable(),
  currentFile: z.string().nullable(),
  /** Bytes downloaded so far (url repos only; null for local repos). */
  bytesReceived: z.number().int().nonnegative().nullable(),
  /** Total expected download size when known; null for local repos. */
  totalBytes: z.number().int().nonnegative().nullable(),
  /** Bound image ids, after the pull registers them. */
  images: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  error: z.string().nullable(),
});

export type ImageRepoKind = z.infer<typeof ImageRepoKindSchema>;
export type ImageRepo = z.infer<typeof ImageRepoSchema>;
export type RepoEntry = z.infer<typeof RepoEntrySchema>;
export type RepoListing = z.infer<typeof RepoListingSchema>;
export type RepoPull = z.infer<typeof RepoPullSchema>;
export type RepoPullStatus = z.infer<typeof RepoPullStatusSchema>;
