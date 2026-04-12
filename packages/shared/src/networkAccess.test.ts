import { describe, expect, it } from "vitest";

import { resolveBindMode, resolveListenHost } from "./networkAccess.js";

describe("networkAccess", () => {
  it("defaults to localhost mode", () => {
    expect(resolveBindMode(undefined)).toBe("localhost");
    expect(resolveBindMode("invalid")).toBe("localhost");
    expect(resolveListenHost(undefined)).toBe("127.0.0.1");
  });

  it("maps lan mode to a public listen host", () => {
    expect(resolveBindMode("lan")).toBe("lan");
    expect(resolveListenHost("lan")).toBe("0.0.0.0");
  });
});
