import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { readTopologyUpload } from "./packageReader.js";

describe("readTopologyUpload", () => {
  it("reads a plain EVE unl file", async () => {
    const result = await readTopologyUpload({
      fileName: "demo.unl",
      content: Buffer.from("<lab><topology /></lab>"),
    });

    expect(result.format).toBe("eve-unl");
    expect(result.topologyPath).toBe("demo.unl");
  });

  it("reads a gns3 file from a project zip", async () => {
    const zip = new JSZip();
    zip.file("project-files/demo.gns3", JSON.stringify({ name: "demo" }));
    const content = Buffer.from(
      await zip.generateAsync({ type: "uint8array" }),
    );

    const result = await readTopologyUpload({
      fileName: "demo.gns3project",
      content,
    });

    expect(result.format).toBe("gns3-project");
    expect(result.topologyPath).toBe("project-files/demo.gns3");
  });

  it("rejects packages with multiple topology files", async () => {
    const zip = new JSZip();
    zip.file("a.unl", "<lab />");
    zip.file("b.unl", "<lab />");
    const content = Buffer.from(
      await zip.generateAsync({ type: "uint8array" }),
    );

    await expect(
      readTopologyUpload({ fileName: "many.zip", content }),
    ).rejects.toThrow(/multiple topology files/i);
  });
});
