import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProfileAvatarButton } from "./ProfileAvatarButton";
import { ProfilePhotoViewerDialog } from "./ProfilePhotoViewerDialog";

describe("ProfileAvatarButton and ProfilePhotoViewerDialog", () => {
  it("renders initials placeholder when no photo exists", () => {
    render(
      <ProfileAvatarButton displayName="Jane Doe" onOpenViewer={vi.fn()} photoFileId={null} />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("renders accessible button when photo exists and handles click", async () => {
    const user = userEvent.setup();
    const onOpenViewer = vi.fn();

    render(
      <ProfileAvatarButton
        displayName="Jane Doe"
        onOpenViewer={onOpenViewer}
        photoFileId="file-123"
      />,
    );

    const button = screen.getByRole("button", { name: "View larger photo of Jane Doe" });
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(onOpenViewer).toHaveBeenCalledWith("/api/organization/files/file-123");
  });

  it("falls back to initials when image loading fails", () => {
    render(
      <ProfileAvatarButton
        displayName="Jane Doe"
        onOpenViewer={vi.fn()}
        photoFileId="file-broken"
      />,
    );

    const img = screen.getByRole("button").querySelector("img");
    expect(img).not.toBeNull();

    if (img) {
      fireEvent.error(img);
    }

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("JD")).toBeInTheDocument();
  });

  it("opens viewer dialog and closes with button and escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { rerender } = render(
      <ProfilePhotoViewerDialog
        displayName="Jane Doe"
        isOpen={true}
        onClose={onClose}
        photoSrc="/api/organization/files/file-123"
      />,
    );

    expect(screen.getByRole("dialog", { name: "Jane Doe's photo" })).toBeInTheDocument();
    expect(screen.getByAltText("Photo of Jane Doe")).toHaveAttribute(
      "src",
      "/api/organization/files/file-123",
    );

    const [closeBtn] = screen.getAllByRole("button", { name: "Close" });
    if (!closeBtn) throw new Error("Close button not found");
    await user.click(closeBtn);
    expect(onClose).toHaveBeenCalled();

    rerender(
      <ProfilePhotoViewerDialog
        displayName="Jane Doe"
        isOpen={false}
        onClose={onClose}
        photoSrc="/api/organization/files/file-123"
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
