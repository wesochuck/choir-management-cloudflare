import {
  organizationProfileSchema,
  type OrganizationProfile,
  type OrganizationProfileRequest,
} from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../../../api";
import { emptyProfile } from "../RosterPage/utils";
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
  const [addOpen, setAddOpen] = useState(false);
  const [addProfile, setAddProfile] = useState<OrganizationProfileRequest>(emptyProfile);

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
      <button
        onClick={() => {
          setAddOpen(true);
        }}
        type="button"
      >
        Open Add Profile
      </button>
      <ProfileEditorDialog
        {...editor.dialogProps}
        editingId={addOpen ? null : editor.editingId}
        editingProfileRecord={addOpen ? null : editor.dialogProps.editingProfileRecord}
        onClose={
          addOpen
            ? () => {
                setAddOpen(false);
              }
            : editor.closeProfile
        }
        open={addOpen || editor.open}
        profile={addOpen ? addProfile : editor.dialogProps.profile}
        saveLabel={saveLabel}
        setProfile={addOpen ? setAddProfile : editor.dialogProps.setProfile}
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

  it("renders status automation policy text and sticky footer actions (#178)", async () => {
    const user = userEvent.setup();
    render(<ProfileEditorHarness />);

    await user.click(screen.getByRole("button", { name: "Open Editor" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Profile" });
    expect(dialog).toBeInTheDocument();

    // Critical instructions and status automation policy text must be fully present in the document
    expect(
      screen.getByText(
        /Selecting a status does not turn automation off\. The Profile may be updated by the roster rules until you explicitly manage status manually\./,
      ),
    ).toBeInTheDocument();

    // Dialog footer must provide cancel and submit action buttons
    const footer = dialog.querySelector(".profile-editor-footer");
    expect(footer).not.toBeNull();
    expect(footer instanceof HTMLElement).toBe(true);
    if (!footer || !(footer instanceof HTMLElement)) return;

    expect(within(footer).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(footer).getByRole("button", { name: "Save Profile" })).toBeInTheDocument();
  });

  it("announces single authoritative heading and preserves dialog accessible name in Add and Edit modes (#184)", async () => {
    const user = userEvent.setup();
    render(<ProfileEditorHarness />);

    // Test Add Profile mode
    await user.click(screen.getByRole("button", { name: "Open Add Profile" }));
    const addDialog = screen.getByRole("dialog", { name: "Add Profile" });
    expect(addDialog).toBeInTheDocument();
    expect(addDialog).toHaveAccessibleDescription(
      "Profile details and roster attributes belong only to this Organization.",
    );

    // Verify there is exactly one level-2 heading in the dialog header
    const headerDetails = addDialog.querySelector(".profile-editor-header__details");
    expect(headerDetails).toBeInstanceOf(HTMLElement);
    if (!(headerDetails instanceof HTMLElement)) return;
    const addHeadings = within(headerDetails).getAllByRole("heading", { level: 2 });
    expect(addHeadings).toHaveLength(1);
    expect(addHeadings[0]).toHaveTextContent("Add Profile");

    // Close Add Profile dialog
    const cancelButton = within(addDialog).getByRole("button", { name: "Cancel" });
    await user.click(cancelButton);

    // Test Edit Profile mode
    await user.click(screen.getByRole("button", { name: "Open Editor" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit Profile" });
    expect(editDialog).toBeInTheDocument();

    const editHeaderDetails = editDialog.querySelector(".profile-editor-header__details");
    expect(editHeaderDetails).toBeInstanceOf(HTMLElement);
    if (!(editHeaderDetails instanceof HTMLElement)) return;
    const editHeadings = within(editHeaderDetails).getAllByRole("heading", {
      level: 2,
    });
    expect(editHeadings).toHaveLength(1);
    expect(editHeadings[0]).toHaveTextContent("Alex Rivera");
  });
});
