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
      configInjectMethod: "csr1000v-vfat",
      startupConfig: "hostname r1\nend\n",
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
      configInjectMethod: "csr1000v-vfat",
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
      configInjectMethod: null,
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
      configInjectMethod: null,
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
      devices={[]}
      onLoadProvider={vi.fn().mockResolvedValue({
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:9999/v1",
        model: "test-model",
        hasApiKey: true,
        authMode: "key",
        account: null,
      })}
      onSaveProvider={vi.fn().mockResolvedValue({
        provider: "openai-compatible",
        baseUrl: "http://127.0.0.1:9999/v1",
        model: "test-model",
        hasApiKey: true,
        authMode: "key",
        account: null,
      })}
      onProbeModels={vi
        .fn()
        .mockResolvedValue({ models: ["gpt-4o", "llama3"] })}
      onStartOpencodeLogin={vi.fn()}
      onPollOpencodeLogin={vi.fn()}
      onDisconnectOpencode={vi.fn().mockResolvedValue(undefined)}
      onPreview={vi.fn().mockResolvedValue(matchedPreview)}
      onCommit={vi.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );
}

describe("AiLabBuilderDialog", () => {
  afterEach(() => cleanup());

  it("starts an OpenCode device sign-in and shows the code", async () => {
    const onStartOpencodeLogin = vi.fn().mockResolvedValue({
      deviceCode: "device-1",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://opencode.ai/console/device?user_code=ABCD-EFGH",
      expiresIn: 600,
      interval: 5,
    });
    const onPollOpencodeLogin = vi
      .fn()
      .mockResolvedValue({ status: "pending" });
    renderDialog({ onStartOpencodeLogin, onPollOpencodeLogin });

    fireEvent.change(screen.getByLabelText("LLM Provider"), {
      target: { value: "opencode-go" },
    });
    expect(
      (screen.getByLabelText("LLM Base URL") as HTMLInputElement).value,
    ).toBe("https://opencode.ai/inference/go/openai/v1");

    fireEvent.click(
      screen.getByRole("button", { name: "Sign in with OpenCode" }),
    );

    await waitFor(() => expect(onStartOpencodeLogin).toHaveBeenCalledTimes(1));
    await screen.findByText("ABCD-EFGH");
  });

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
    expect(onPreview).toHaveBeenCalledWith("two routers and a host", []);
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

  it("auto-detects models for the saved endpoint and offers them", async () => {
    const onProbeModels = vi
      .fn()
      .mockResolvedValue({ models: ["gpt-4o", "llama3"] });
    renderDialog({ onProbeModels });

    await waitFor(() => expect(onProbeModels).toHaveBeenCalled());
    expect(onProbeModels.mock.calls[0][0]).toMatchObject({
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:9999/v1",
    });
    expect(await screen.findByText("2 models detected")).toBeTruthy();
    expect(screen.getByLabelText("LLM Model").getAttribute("list")).toBe(
      "ai-model-options",
    );
  });

  it("shows generated configs with their inject method", async () => {
    renderDialog({});

    fireEvent.change(screen.getByLabelText("Lab Spec"), {
      target: { value: "configured lab" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Lab" }));

    expect(await screen.findByText(/config ✓ \(csr1000v-vfat\)/)).toBeTruthy();
    expect(
      screen.getByText(/r1 config \(.*chars, csr1000v-vfat\)/),
    ).toBeTruthy();
  });

  it("hands the selected devices to preview and commit", async () => {
    const onPreview = vi.fn().mockResolvedValue(matchedPreview);
    const onCommit = vi.fn().mockResolvedValue(undefined);
    renderDialog({
      devices: [
        {
          id: "cisco-xrv9k",
          name: "Cisco IOS-XRv 9000",
          runtime: "qemu",
          imageId: "img-xrv",
        },
        {
          id: "linux-ubuntu-container",
          name: "Ubuntu Container",
          runtime: "container",
        },
      ],
      onPreview,
      onCommit,
    });

    fireEvent.click(screen.getByLabelText("Cisco IOS-XRv 9000 (image bound)"));
    expect(screen.queryByText("AI Triangle Lab")).toBeNull();

    fireEvent.change(screen.getByLabelText("Lab Spec"), {
      target: { value: "two routers and a host" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Lab" }));

    await screen.findByText("AI Triangle Lab");
    expect(onPreview).toHaveBeenCalledWith("two routers and a host", [
      "cisco-xrv9k",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Create Lab" }));
    await waitFor(() => expect(onCommit).toHaveBeenCalled());
    expect(onCommit.mock.calls[0][0].allowedTemplateIds).toEqual([
      "cisco-xrv9k",
      "linux-ubuntu-container",
    ]);
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
