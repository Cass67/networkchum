import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageLibrary } from "./ImageLibrary.js";

afterEach(() => {
  cleanup();
});

describe("ImageLibrary", () => {
  it("renders removed images in the library without showing them as add-node catalog entries", () => {
    render(
      <ImageLibrary
        images={[
          {
            id: "img-1",
            name: "csr1000v.qcow2",
            templateId: null,
            suggestedTemplateId: null,
            source: "upload",
            catalogState: "removed",
          },
        ]}
        onUpload={vi.fn()}
        onBind={vi.fn()}
        onUnbind={vi.fn()}
        onRemoveFromCatalog={vi.fn()}
        onDeleteImageFile={vi.fn()}
      />,
    );

    expect(screen.getByText(/^removed$/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove" }),
    ).not.toBeInTheDocument();
  });

  it("calls remove from catalog for an active image", () => {
    const onRemoveFromCatalog = vi.fn();

    render(
      <ImageLibrary
        images={[
          {
            id: "img-1",
            name: "csr1000v.qcow2",
            templateId: "cisco-asr",
            suggestedTemplateId: "cisco-asr",
            source: "upload",
            catalogState: "active",
          },
        ]}
        onUpload={vi.fn()}
        onBind={vi.fn()}
        onUnbind={vi.fn()}
        onRemoveFromCatalog={onRemoveFromCatalog}
        onDeleteImageFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemoveFromCatalog).toHaveBeenCalledWith("img-1");
  });

  it("calls permanent delete for an image file", () => {
    const onDeleteImageFile = vi.fn();

    render(
      <ImageLibrary
        images={[
          {
            id: "img-1",
            name: "blank-1G.qcow2",
            templateId: null,
            suggestedTemplateId: null,
            source: "scan",
            catalogState: "active",
          },
        ]}
        onUpload={vi.fn()}
        onBind={vi.fn()}
        onUnbind={vi.fn()}
        onRemoveFromCatalog={vi.fn()}
        onDeleteImageFile={onDeleteImageFile}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete File" }));
    expect(onDeleteImageFile).toHaveBeenCalledWith("img-1");
  });
});
