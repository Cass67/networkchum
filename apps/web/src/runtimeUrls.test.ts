import { describe, expect, it } from "vitest";

import {
  isLocalPageHost,
  resolveBridgeBaseUrl,
  resolveConsoleWebSocketUrl,
} from "./runtimeUrls.js";

describe("runtimeUrls", () => {
  it("treats localhost hosts as local bridge targets", () => {
    expect(isLocalPageHost("127.0.0.1")).toBe(true);
    expect(isLocalPageHost("localhost")).toBe(true);
    expect(
      resolveBridgeBaseUrl({
        protocol: "http:",
        hostname: "127.0.0.1",
      }),
    ).toBe("http://127.0.0.1:4010");
  });

  it("disables the native bridge on remote page hosts", () => {
    expect(isLocalPageHost("192.168.1.25")).toBe(false);
    expect(
      resolveBridgeBaseUrl({
        protocol: "http:",
        hostname: "192.168.1.25",
      }),
    ).toBeNull();
  });

  it("uses the page host for console websocket traffic", () => {
    expect(
      resolveConsoleWebSocketUrl(
        {
          protocol: "http:",
          hostname: "192.168.1.25",
        },
        "lab-1",
        "node-1",
      ),
    ).toBe("ws://192.168.1.25:4000/labs/lab-1/nodes/node-1/console");
  });
});
