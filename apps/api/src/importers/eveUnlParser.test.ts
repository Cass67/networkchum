import { describe, expect, it } from "vitest";

import { parseEveUnlTopology } from "./eveUnlParser.js";

const unl = `
<lab name="OSPF Lab">
  <topology>
    <nodes>
      <node id="1" name="R1" type="qemu" template="vios" image="vios-adventerprisek9" left="100" top="200" ram="1024" ethernet="2">
        <interfaces>
          <interface id="0" name="Gi0/0" type="ethernet" network_id="1" />
          <interface id="1" name="Gi0/1" type="ethernet" network_id="2" />
        </interfaces>
        <configs>
          <config id="0">hostname R1</config>
        </configs>
      </node>
      <node id="2" name="R2" type="qemu" template="vios" image="vios-adventerprisek9" left="300" top="200" ethernet="1">
        <interfaces>
          <interface id="0" name="Gi0/0" type="ethernet" network_id="1" />
        </interfaces>
      </node>
    </nodes>
    <networks>
      <network id="1" type="bridge" name="net1" />
      <network id="2" type="bridge" name="stub" />
    </networks>
  </topology>
</lab>`;

describe("parseEveUnlTopology", () => {
  it("normalizes nodes, positions, interfaces, links, and startup config", () => {
    const result = parseEveUnlTopology({
      format: "eve-unl",
      originalFileName: "ospf.unl",
      topologyPath: "ospf.unl",
      content: unl,
      ignoredFiles: [],
    });

    expect(result.name).toBe("OSPF Lab");
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toMatchObject({
      name: "R1",
      templateName: "vios",
      imageName: "vios-adventerprisek9",
      position: { x: 100, y: 200 },
      ramMb: 1024,
      interfaceNames: ["Gi0/0", "Gi0/1"],
      startupConfig: "hostname R1",
    });
    expect(result.links).toEqual([
      {
        sourceNodeId: "1",
        sourceInterface: "Gi0/0",
        targetNodeId: "2",
        targetInterface: "Gi0/0",
        networkName: "net1",
      },
    ]);
  });
});
