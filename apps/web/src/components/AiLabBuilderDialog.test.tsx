import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiLabBuilderDialog } from "./AiLabBuilderDialog.js";

const matchedPreview = {
  labName: "AI Triangle Lab",
  spec: {
    name: "AI Triangle Lab",
    nodes: [
      { name: "r1", templateId: "cisco-xrv9k", role: "core router" },
      { name: "r2", templateId: "cisco-xrv9k", role: "core router" },
      { name: "host1", templateId: "linux-ubuntu-container" },
    ],
    links: [
      {
        name: "r1-r2",
        members: [
          { node: "r1", interfaceIndex: 0 },
          { node: "r2", interfaceIndex: 0 },
        ],
      },
    ],
  },
  nodes: [
    {
      name: "r1",
      requestedTemplate: "cisco-xrv9k",
      status: "matched",
      templateId: "cisco-xrv9k",
      displayName: "Cisco IOS-XRv 9000",
      imageId: "img-xrv",
      imageBound: true,
      interfaceCount: 2,
    },
    {
      name: "r2",
      requestedTemplate: "cisco-xrv9k",
      status: "matched",
      templateId: "cisco-xrv9k",
      displayName: "Cisco IOS-XRv 9000",
      imageId: "img-xrv",
      imageBound: true,
      interfaceCount: 2,
    },
    {
      name: "host1",
      requestedTemplate: "linux-ubuntu-container",
      status: "matched",
      templateId: "linux-ubuntu-container",
      displayName: "Ubuntu Container",
      imageId: null,
      imageBound: false,
      interfaceCount: 1,
    },
  ],
  links: [
    {
      name: "r1-r2",
      members: [
        { node: "r1", interfaceIndex: 0 },
        { node: "r2", interfaceIndex: 0 },
      ],
    },
  ],
  issues: [],
  document: { id: "lab-preview" },
};

const unresolvedPreview = {
  ...matchedPreview,
  nodes: [
    ...matchedPreview.nodes,
    {
      name: "mystery",
      requestedTemplate: "not-a-real-template",
      status: "unresolved",
      templateId: null,
      displayName: null,
      imageId: null,
      imageBound: false,
      interfaceCount: null,
    },
  ],
  document: null,
};

function renderDialog(
  props: Partial<Parameters<typeof AiLabBuilderDialog>[0]>,
) {
  return render(
    <AiLabBuilderDialog
      open
      onClose={vi.fn()}
      onLoadProvider={vi.fn().mockResolvedValue({
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:9999/v1",
        model: "test-model",
        hasApiKey: true,
      })}
      onSaveProvider={vi.fn().mockResolvedValue({ hasApiKey: true })}
      onPreview={vi.fn().mockResolvedValue(matchedPreview)}
      onCommit={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );
}

describe("AiLabBuilderDialog", () => {
  afterEach(() => cleanup());

  it("loads provider settings and generates a preview", async () => {
    const onPreview = vi.fn().mockResolvedValue(matchedPreview);
    renderDialog({ onPreview });

    await waitFor(() =>
      expect(screen.getByLabelText("LLM Base URL")).toHaveProperty(
        "value",
        "http://127.0.0.1:9999/v1",
      ),
    );

    fireEvent.change(screen.getByLabelText("Lab Spec"), {
      target: { value: "two routers and a host" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Lab" }));

    expect(await screen.findByText("AI Triangle Lab")).toBeTruthy();
    expect(screen.getByText("host1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Lab" })).toHaveProperty(
      "disabled",
      false,
    );
    expect(onPreview).toHaveBeenCalledWith("two routers and a host");
  });

  it("passes the preview name and spec on commit", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    renderDialog({ onCommit });

    fireEvent.change(screen.getByLabelText("Lab Spec"), {
      target: { value: "two routers and a host" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Lab" }));
    await screen.findByText("AI Triangle Lab");

    fireEvent.click(screen.getByRole("button", { name: "Create Lab" }));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit.mock.calls[0][0].name).toBe("AI Triangle Lab");
    expect(onCommit.mock.calls[0][0].spec.nodes).toHaveLength(3);
  });

  it("disables commit when a node is unresolved and shows the issue", async () => {
    renderDialog({ onPreview: vi.fn().mockResolvedValue(unresolvedPreview) });

    fireEvent.change(screen.getByLabelText("Lab Spec"), {
      target: { value: "something impossible" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Lab" }));

    expect(await screen.findByText("not-a-real-template")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Lab" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("renders provider errors", async () => {
    renderDialog({
      onPreview: vi
        .fn()
        .mockRejectedValue(new Error("LLM provider responded 503: overloaded")),
    });

    fireEvent.change(screen.getByLabelText("Lab Spec"), {
      target: { value: "two routers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Lab" }));

    expect(await screen.findByText(/LLM provider responded 503/)).toBeTruthy();
    expect(screen.queryByText("AI Triangle Lab")).toBeNull();
  });
});
