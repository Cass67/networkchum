import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createLab, listLabs } from "./labStore.js";

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("labStore", () => {
  it("uses the configured data directory override", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "networkchum-data-"));
    tempDirs.push(tempDir);
    process.env.NETWORKCHUM_DATA_DIR = tempDir;

    await createLab("Isolated Lab");
    const labs = await listLabs();

    expect(labs).toHaveLength(1);
    expect(labs[0]?.name).toBe("Isolated Lab");
  });
});
