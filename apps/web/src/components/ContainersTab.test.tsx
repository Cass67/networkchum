import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContainersTab } from "./ContainersTab.js";

afterEach(() => {
  cleanup();
});

describe("ContainersTab", () => {
  it("saves a reusable template from a local image", async () => {
    const saveContainerTemplate = vi.fn(async () => undefined);
    const onTemplateSaved = vi.fn(async () => undefined);

    render(
      <ContainersTab
        api={{
          getContainerRuntime: async () => ({
            engine: "podman",
            available: true,
            message: null,
          }),
          listContainerImages: async () => ({
            engine: "podman",
            images: [
              {
                id: "img-1",
                imageRef: "oraclelinux:9-slim",
                repository: "oraclelinux",
                tag: "9-slim",
                size: "72MB",
              },
            ],
            message: null,
          }),
          saveContainerTemplate,
        }}
        activeLabId="lab-1"
        onTemplateSaved={onTemplateSaved}
      />,
    );

    await screen.findByText("oraclelinux:9-slim");
    fireEvent.click(screen.getByRole("button", { name: "Use..." }));
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));

    await waitFor(() => {
      expect(saveContainerTemplate).toHaveBeenCalledWith({
        displayName: "Oraclelinux 9-slim",
        imageRef: "oraclelinux:9-slim",
        registry: "docker-hub",
        shell: "bash",
      });
      expect(onTemplateSaved).toHaveBeenCalled();
    });
  });

  it("blocks one-off creation when no lab is active", async () => {
    render(
      <ContainersTab
        api={{
          getContainerRuntime: async () => ({
            engine: "docker",
            available: true,
            message: null,
          }),
          listContainerImages: async () => ({
            engine: "docker",
            images: [
              {
                id: "img-1",
                imageRef: "alpine:latest",
                repository: "alpine",
                tag: "latest",
              },
            ],
            message: null,
          }),
        }}
      />,
    );

    await screen.findByRole("list", { name: "Local container images" });
    fireEvent.click(screen.getByRole("button", { name: "Use..." }));
    fireEvent.change(screen.getByLabelText("Container Action"), {
      target: { value: "create-node" },
    });

    expect(
      screen.getByText(
        "Select or create a lab before creating a one-off container node.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Node" })).toBeDisabled();
  });
});
