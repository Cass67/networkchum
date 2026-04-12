import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLab, getLab, updateLabDocument } from "../labs/labStore.js";
import { deleteCable } from "./cableService.js";

let tempDataDir = "";

beforeEach(async () => {
  tempDataDir = await mkdtemp(
    path.join(os.tmpdir(), "networkchum-cable-service-"),
  );
  process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
});

afterEach(async () => {
  delete process.env.NETWORKCHUM_DATA_DIR;
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = "";
  }
});

describe("deleteCable", () => {
  it("removes a cable network and its attachments", async () => {
    const lab = await createLab("Cable Service Lab");
    await updateLabDocument(lab.id, {
      ...lab.document,
      networks: [
        { id: "net-1", kind: "ethernet", name: "link", visible: false },
      ],
      attachments: [{ interfaceId: "if-1", networkId: "net-1" }],
    });

    const result = await deleteCable(lab.id, "net-1");

    expect(result?.document.networks).toHaveLength(0);
    expect(result?.document.attachments).toHaveLength(0);
    expect((await getLab(lab.id))?.document.networks).toHaveLength(0);
  });
});
