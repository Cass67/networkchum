import { describe, expect, it } from "vitest";

import { parseGns3Topology } from "./gns3Parser.js";

describe("parseGns3Topology", () => {
  it("normalizes nodes and links", () => {
    const result = parseGns3Topology({
      format: "gns3",
      originalFileName: "demo.gns3",
      topologyPath: "demo.gns3",
      ignoredFiles: [],
      content: JSON.stringify({
        name: "GNS3 Demo",
        topology: {
          nodes: [
            {
              node_id: "n1",
              name: "R1",
              node_type: "qemu",
              template_id: "iosv",
              x: 10,
              y: 20,
              properties: { hda_disk_image: "iosv.qcow2", ram: 1024 },
              ports: [{ adapter_number: 0, port_number: 0, name: "Gi0/0" }],
            },
            {
              node_id: "n2",
              name: "R2",
              node_type: "qemu",
              template_id: "iosv",
              x: 200,
              y: 20,
              properties: { hda_disk_image: "iosv.qcow2" },
              ports: [{ adapter_number: 0, port_number: 0, name: "Gi0/0" }],
            },
          ],
          links: [
            {
              nodes: [
                { node_id: "n1", adapter_number: 0, port_number: 0 },
                { node_id: "n2", adapter_number: 0, port_number: 0 },
              ],
            },
          ],
        },
      }),
    });

    expect(result.name).toBe("GNS3 Demo");
    expect(result.nodes[0]).toMatchObject({
      foreignId: "n1",
      name: "R1",
      templateName: "iosv",
      imageName: "iosv.qcow2",
      position: { x: 10, y: 20 },
      interfaceNames: ["Gi0/0"],
    });
    expect(result.links).toHaveLength(1);
  });
});
