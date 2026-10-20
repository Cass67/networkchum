import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageLibrary } from "./ImageLibrary.js";

afterEach(() => {
  cleanup();
});

describe("ImageLibrary", () => {
  it("renders removed images in the library without a remove action", () => {
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
        templates={[{ id: "cisco-asr", name: "Cisco ASR" }]}
        onUpload={vi.fn()}
        onBind={vi.fn()}
        onUnbind={vi.fn()}
        onRemoveFromCatalog={vi.fn()}
        onDeleteImageFile={vi.fn()}
      />,
    );

    expect(screen.getByText(/^removed$/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restore…" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove from catalog…" }),
    ).not.toBeInTheDocument();
  });

  it("removes an active image from the catalog after confirming", () => {
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

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for csr1000v.qcow2" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Remove from catalog…" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onRemoveFromCatalog).toHaveBeenCalledWith("img-1");
  });

  it("deletes an image file after confirming", () => {
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

    fireEvent.click(
      screen.getByRole("button", { name: "More actions for blank-1G.qcow2" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Delete file from disk…" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(onDeleteImageFile).toHaveBeenCalledWith("img-1");
  });

  it("unbinds a bound image with the primary action", () => {
    const onUnbind = vi.fn();

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
        onUnbind={onUnbind}
        onRemoveFromCatalog={vi.fn()}
        onDeleteImageFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Unbind" }));
    expect(onUnbind).toHaveBeenCalledWith("img-1");
  });

  it("binds an unbound image through the bind dialog", async () => {
    const onBind = vi.fn();

    render(
      <ImageLibrary
        images={[
          {
            id: "img-1",
            name: "asr-1.qcow2",
            templateId: null,
            suggestedTemplateId: "cisco-asr",
            source: "upload",
            catalogState: "active",
          },
        ]}
        templates={[
          { id: "cisco-asr", name: "Cisco ASR" },
          { id: "linux-generic", name: "Linux Generic VM" },
        ]}
        onUpload={vi.fn()}
        onBind={onBind}
        onUnbind={vi.fn()}
        onRemoveFromCatalog={vi.fn()}
        onDeleteImageFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Bind…" }));
    const select = screen.getByLabelText("Device template");
    expect(select).toHaveValue("cisco-asr");
    fireEvent.click(screen.getByRole("button", { name: "Bind" }));

    await vi.waitFor(() => {
      expect(onBind).toHaveBeenCalledWith("img-1", "cisco-asr");
    });
  });

  it("preselects the guessed device type in the upload wizard", () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);

    render(
      <ImageLibrary
        images={[]}
        templates={[
          { id: "cisco-asr", name: "Cisco ASR" },
          { id: "linux-generic", name: "Linux Generic VM" },
        ]}
        onUpload={onUpload}
        onBind={vi.fn()}
        onUnbind={vi.fn()}
        onRemoveFromCatalog={vi.fn()}
        onDeleteImageFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Upload Image" }));
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [new File(["qcow2"], "asr-1.qcow2")],
      },
    });

    expect(screen.getByText("This looks like…")).toBeInTheDocument();
    expect(screen.getByLabelText("Device type")).toHaveValue("cisco-asr");
    expect(screen.getByText(/Matched from the file name/)).toBeInTheDocument();
  });

  it("uploads and binds through the wizard", async () => {
    const onUpload = vi.fn().mockResolvedValue(undefined);

    render(
      <ImageLibrary
        images={[]}
        templates={[
          { id: "linux-generic", name: "Linux Generic VM" },
          { id: "cisco-asr", name: "Cisco ASR" },
        ]}
        onUpload={onUpload}
        onBind={vi.fn()}
        onUnbind={vi.fn()}
        onRemoveFromCatalog={vi.fn()}
        onDeleteImageFile={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Upload Image" }));
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [new File(["qcow2"], "blank-1G.qcow2")],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload & bind" }));

    await vi.waitFor(() => {
      expect(onUpload).toHaveBeenCalledWith(expect.any(File), "linux-generic");
    });
  });
});
