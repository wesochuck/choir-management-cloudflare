import { organizationProfileSchema, type OrganizationProfile } from "@choir/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../../api";
import { ProfileEditorDialog } from "./ProfileEditorDialog";
import { useProfileEditor } from "./useProfileEditor";

vi.mock("../../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    deletePrivateOrganizationFile: vi.fn(),
    listOrganizationMemberships: vi.fn(),
    setOrganizationProfilePhoto: vi.fn(),
    updateOrganizationProfile: vi.fn(),
    uploadPrivateOrganizationFile: vi.fn(),
  };
});

const sampleProfile: OrganizationProfile = organizationProfileSchema.parse({
  createdAt: new Date().toISOString(),
  displayName: "Alex Rivera",
  id: "33333333-3333-4333-8333-333333333333",
  phone: "555-0199",
  photoFileId: null,
  updatedAt: new Date().toISOString(),
  voicePart: "Tenor",
});

function ProfileEditorHarness({
  onSaved,
  saveLabel,
}: {
  readonly onSaved?: (saved: OrganizationProfile) => void;
  readonly saveLabel?: string;
}) {
  const editor = useProfileEditor({
    onSaved,
  });

  return (
    <div>
      <button
        onClick={() => {
          editor.openProfile(sampleProfile);
        }}
        type="button"
      >
        Open Editor
      </button>
      <ProfileEditorDialog
        {...editor.dialogProps}
        onClose={editor.closeProfile}
        open={editor.open}
        saveLabel={saveLabel}
      />
    </div>
  );
}

describe("ProfileEditorDialog photo save coordination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.listOrganizationMemberships).mockResolvedValue({
      memberships: [],
      requestId: "req-memberships",
      truncated: false,
    });
    vi.mocked(api.updateOrganizationProfile).mockResolvedValue(sampleProfile);
    vi.mocked(api.uploadPrivateOrganizationFile).mockResolvedValue({
      contentType: "image/jpeg",
      fileName: "chosen-photo.jpg",
      id: "file-photo-new",
      requestId: "req-file",
      sizeBytes: 2048,
      uploadedAt: new Date().toISOString(),
    });
    vi.mocked(api.setOrganizationProfilePhoto).mockResolvedValue(undefined);

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("enables main save when photo is staged, preserves photo across tab switches, and saves both", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    render(<ProfileEditorHarness onSaved={onSaved} saveLabel="Save Profile" />);

    await user.click(screen.getByRole("button", { name: "Open Editor" }));
    expect(screen.getByRole("dialog", { name: "Edit Profile" })).toBeInTheDocument();

    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();

    // Stage a photo file
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput instanceof HTMLInputElement).toBe(true);
    if (!fileInput || !(fileInput instanceof HTMLInputElement)) return;

    const chosenFile = new File(["bytes"], "chosen-photo.jpg", { type: "image/jpeg" });
    await user.upload(fileInput, chosenFile);

    expect(screen.getByText("Ready to upload: chosen-photo.jpg")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    // Switch to Email & notifications tab
    const emailTab = screen.getByRole("tab", { name: "Email & notifications" });
    await user.click(emailTab);

    // Info tab is hidden but mounted (forceMount)
    expect(screen.getByText("Ready to upload: chosen-photo.jpg")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    // Submit form via main Save button
    const saveButton = screen.getByRole("button", { name: "Save Profile" });
    await user.click(saveButton);

    expect(api.updateOrganizationProfile).toHaveBeenCalledWith(
      sampleProfile.id,
      expect.objectContaining({ displayName: "Alex Rivera" }),
      undefined,
    );
    expect(api.uploadPrivateOrganizationFile).toHaveBeenCalledWith(chosenFile);
    expect(api.setOrganizationProfilePhoto).toHaveBeenCalledWith(
      sampleProfile.id,
      "file-photo-new",
    );
    expect(onSaved).toHaveBeenCalled();

    // Dialog should close on full success
    expect(screen.queryByRole("dialog", { name: "Edit Profile" })).not.toBeInTheDocument();
  });

  it("keeps dialog open and retains draft if text succeeds but photo upload fails", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    vi.mocked(api.uploadPrivateOrganizationFile).mockRejectedValue(
      new Error("Network upload failure"),
    );

    render(<ProfileEditorHarness onSaved={onSaved} saveLabel="Save & Return to RSVPs" />);

    await user.click(screen.getByRole("button", { name: "Open Editor" }));
    expect(screen.getByRole("dialog", { name: "Edit Profile" })).toBeInTheDocument();

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput instanceof HTMLInputElement).toBe(true);
    if (!fileInput || !(fileInput instanceof HTMLInputElement)) return;

    const chosenFile = new File(["bytes"], "chosen-photo.jpg", { type: "image/jpeg" });
    await user.upload(fileInput, chosenFile);

    const saveButton = screen.getByRole("button", { name: "Save & Return to RSVPs" });
    expect(saveButton).not.toBeDisabled();

    await user.click(saveButton);

    expect(api.updateOrganizationProfile).toHaveBeenCalled();
    expect(api.uploadPrivateOrganizationFile).toHaveBeenCalledWith(chosenFile);

    // Surfaced photo error
    expect(
      await screen.findByText(
        "Profile details saved, but photo upload failed. Retry photo upload.",
      ),
    ).toBeInTheDocument();

    // Dialog remains open for retry
    expect(screen.getByRole("dialog", { name: "Edit Profile" })).toBeInTheDocument();
    expect(screen.getByText("Ready to upload: chosen-photo.jpg")).toBeInTheDocument();
  });
});
