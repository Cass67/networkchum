import fs from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import { describe, expect, it } from "vitest";

import { getCatalog } from "./getCatalog.js";

describe("getCatalog", () => {
  it("includes the lab bridge interconnect template", async () => {
    const tempDataDir = mkdtempSync(`${os.tmpdir()}/networkchum-catalog-`);
    process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
    try {
      const catalog = await getCatalog();
      const entry = catalog.find((candidate) => candidate.id === "lab-bridge");
      expect(entry).toBeDefined();
      expect(entry?.template.runtime).toBe("lab-bridge");
      expect(entry?.source).toBe("built-in");
    } finally {
      delete process.env.NETWORKCHUM_DATA_DIR;
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });
});
