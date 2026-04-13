import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Template } from "@networkchum/shared";

import {
  listUserContainerTemplates,
  saveUserContainerTemplate,
} from "./userContainerTemplateStore.js";

let tempDataDir = "";
let priorDataDir: string | undefined;

function oracleTemplate(): Template {
  return {
    id: "container-oraclelinux",
    runtime: "container",
    displayName: "Oracle Linux 9",
    vendor: "Oracle",
    deviceRoleIcon: "host",
    boot: {
      console: "serial",
      acceleration: "n/a",
    },
    configSchema: {
      ramMb: { default: 512, min: 128, max: 8192 },
      vcpu: { default: 1, min: 1, max: 4 },
      interfaceCount: { default: 1, min: 1, max: 4 },
    },
    container: {
      imageRef: "oraclelinux:9-slim",
      registry: "docker-hub",
      engine: "podman",
      defaultShell: "sh",
    },
  };
}

beforeEach(async () => {
  priorDataDir = process.env.NETWORKCHUM_DATA_DIR;
  tempDataDir = await mkdtemp(
    path.join(os.tmpdir(), "networkchum-containers-"),
  );
  process.env.NETWORKCHUM_DATA_DIR = tempDataDir;
});

afterEach(async () => {
  if (priorDataDir === undefined) {
    delete process.env.NETWORKCHUM_DATA_DIR;
  } else {
    process.env.NETWORKCHUM_DATA_DIR = priorDataDir;
  }
  if (tempDataDir) {
    await rm(tempDataDir, { recursive: true, force: true });
    tempDataDir = "";
  }
  priorDataDir = undefined;
});

describe("userContainerTemplateStore", () => {
  it("persists and reloads saved user container templates", async () => {
    await saveUserContainerTemplate(oracleTemplate());

    expect(listUserContainerTemplates()).toEqual([oracleTemplate()]);
  });
});
