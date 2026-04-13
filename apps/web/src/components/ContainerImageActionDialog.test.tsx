import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ContainerImageActionDialog } from "./ContainerImageActionDialog.js";

describe("ContainerImageActionDialog", () => {
  it("defaults to saving a reusable template", () => {
    const onSubmit = vi.fn();

    render(
      <ContainerImageActionDialog
        open
        target={{
          imageRef: "oraclelinux:9-slim",
          registry: "docker-hub",
          engine: "podman",
        }}
        activeLabId="lab-1"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText("Container Action")).toHaveValue(
      "save-template",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Template" }));

    expect(onSubmit).toHaveBeenCalledWith({
      action: "save-template",
      displayName: "Oraclelinux 9-slim",
      imageRef: "oraclelinux:9-slim",
      registry: "docker-hub",
      shell: "bash",
    });
  });
});
