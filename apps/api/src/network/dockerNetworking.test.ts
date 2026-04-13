import { describe, expect, it } from "vitest";

import type { LabDocument } from "@networkchum/shared";

import {
  buildDockerNetworkConnectCommand,
  buildDockerNetworkCreateCommand,
  buildDockerNetworkDisconnectCommand,
  buildDockerNetworkRemoveCommand,
  dockerNetworkName,
  getNodeAttachmentsForContainer,
} from "./dockerNetworking.js";

describe("dockerNetworking", () => {
  describe("dockerNetworkName", () => {
    it("prefixes network id with nc-net-", () => {
      expect(dockerNetworkName("net-123")).toBe("nc-net-net-123");
    });
  });

  describe("buildDockerNetworkCreateCommand", () => {
    it("builds docker network create command", () => {
      expect(buildDockerNetworkCreateCommand("net-1")).toEqual([
        "docker",
        "network",
        "create",
        "--driver",
        "bridge",
        "nc-net-net-1",
      ]);
    });

    it("builds podman network create command", () => {
      expect(buildDockerNetworkCreateCommand("net-1", "podman")).toEqual([
        "podman",
        "network",
        "create",
        "--driver",
        "bridge",
        "nc-net-net-1",
      ]);
    });
  });

  describe("buildDockerNetworkConnectCommand", () => {
    it("builds docker network connect command", () => {
      expect(buildDockerNetworkConnectCommand("net-1", "my-container")).toEqual(
        ["docker", "network", "connect", "nc-net-net-1", "my-container"],
      );
    });
  });

  describe("buildDockerNetworkDisconnectCommand", () => {
    it("builds docker network disconnect command with force flag", () => {
      expect(
        buildDockerNetworkDisconnectCommand("net-1", "my-container"),
      ).toEqual([
        "docker",
        "network",
        "disconnect",
        "nc-net-net-1",
        "my-container",
        "--force",
      ]);
    });
  });

  describe("buildDockerNetworkRemoveCommand", () => {
    it("builds docker network rm command", () => {
      expect(buildDockerNetworkRemoveCommand("net-1")).toEqual([
        "docker",
        "network",
        "rm",
        "nc-net-net-1",
      ]);
    });
  });

  describe("getNodeAttachmentsForContainer", () => {
    function makeLab(overrides: Partial<LabDocument> = {}): LabDocument {
      return {
        id: "lab-1",
        name: "Test",
        version: 1,
        canvas: { zoom: 1, backgroundImage: null },
        nodes: [
          {
            id: "node-a",
            name: "host-a",
            runtime: "container",
            templateId: "tmpl",
            position: { x: 0, y: 0 },
            config: { vcpu: 1, ramMb: 256, interfaceCount: 2 },
            state: { desiredPower: "off" },
            interfaces: [
              { id: "if-a-0", name: "eth0", slot: 0 },
              { id: "if-a-1", name: "eth1", slot: 1 },
            ],
          },
        ],
        networks: [],
        attachments: [],
        annotations: [],
        startupConfigSets: [],
        nodeBootActions: [],
        activeConfigSetId: null,
        ...overrides,
      };
    }

    it("returns empty when node has no attachments", () => {
      const lab = makeLab();
      expect(getNodeAttachmentsForContainer(lab, "node-a")).toEqual([]);
    });

    it("returns sorted attachments by slot", () => {
      const lab = makeLab({
        networks: [
          { id: "net-1", kind: "ethernet", name: "A", visible: false },
          { id: "net-2", kind: "ethernet", name: "B", visible: false },
        ],
        attachments: [
          { interfaceId: "if-a-1", networkId: "net-2" },
          { interfaceId: "if-a-0", networkId: "net-1" },
        ],
      });

      const result = getNodeAttachmentsForContainer(lab, "node-a");
      expect(result).toEqual([
        { networkId: "net-1", slot: 0 },
        { networkId: "net-2", slot: 1 },
      ]);
    });

    it("returns empty for unknown node", () => {
      const lab = makeLab();
      expect(getNodeAttachmentsForContainer(lab, "node-nonexistent")).toEqual(
        [],
      );
    });
  });
});
