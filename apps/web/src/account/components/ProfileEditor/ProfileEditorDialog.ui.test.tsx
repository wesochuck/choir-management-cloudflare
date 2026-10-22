import {
  organizationProfileSchema,
  type OrganizationProfile,
  type OrganizationProfileRequest,
  type OrganizationRosterConfiguration,
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
    getOrganizationProfileFolderNumbers: vi.fn(),
    listOrganizationMemberships: vi.fn(),
    setOrganizationProfilePhoto: vi.fn(),
    updateOrganizationProfile: vi.fn(),
    updateOrganizationProfileFolderNumber: vi.fn(),
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
  rosterConfiguration,
  sampleToOpen,
  saveLabel,
}: {
  readonly onSaved?: (saved: OrganizationProfile) => void;
  readonly rosterConfiguration?: OrganizationRosterConfiguration;
  readonly sampleToOpen?: OrganizationProfile;
  readonly saveLabel?: string;
}) {
  const editor = useProfileEditor({
    onSaved,
    rosterConfiguration,
  });
  const [addOpen, setAddOpen] = useState(false);
  const [addProfile, setAddProfile] = useState<OrganizationProfileRequest>(emptyProfile);

  return (
    <div>
      <button
        onClick={() => {
          editor.openProfile(sampleToOpen ?? sampleProfile);
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
    vi.mocked(api.getOrganizationProfileFolderNumbers).mockResolvedValue([
      {
        eventId: "event-1111",
        eventTitle: "Spring Gala",
        eventType: "Performance",
        folderNumber: "42",
        folderReturned: false,
        profileId: sampleProfile.id,
        returnedAt: null,
        startsAt: "2026-05-01T19:00:00Z",
        updatedAt: null,
      },
    ]);
    vi.mocked(api.updateOrganizationProfileFolderNumber).mockResolvedValue({
      eventId: "event-1111",
      eventTitle: "Spring Gala",
      eventType: "Performance",
      folderNumber: "42",
      folderReturned: true,
      profileId: sampleProfile.id,
      returnedAt: new Date().toISOString(),
      startsAt: "2026-05-01T19:00:00Z",
      updatedAt: new Date().toISOString(),
    });

    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("marks only changed sections, keeps markers across navigation, and clears reverted edits", async () => {
    const user = userEvent.setup();
    render(<ProfileEditorHarness />);
    await user.click(screen.getByRole("button", { name: "Open Editor" }));

    const infoTab = screen.getByRole("tab", { name: "Profile info" });
    const emailTab = screen.getByRole("tab", { name: "Email & notifications" });
    const foldersTab = screen.getByRole("tab", { name: "Folder numbers" });
    expect(infoTab).toHaveAttribute("aria-selected", "true");
    expect(infoTab).not.toHaveAccessibleDescription();
    expect(screen.queryByText("Unsaved", { exact: true })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Display name"), " edited");
    expect(infoTab).toHaveAccessibleDescription("Unsaved");
    expect(emailTab).not.toHaveAccessibleDescription();
    expect(
      screen.getByRole("option", { name: "Profile info — Unsaved changes" }),
    ).toBeInTheDocument();

    await user.click(emailTab);
    expect(emailTab).toHaveAttribute("aria-selected", "true");
    expect(emailTab).not.toHaveAccessibleDescription();
    expect(infoTab).toHaveAccessibleDescription("Unsaved");
    await user.click(screen.getByRole("switch", { name: "Do not email" }));
    expect(emailTab).toHaveAccessibleDescription("Unsaved");
    expect(foldersTab).not.toHaveAccessibleDescription();

    await user.click(screen.getByRole("switch", { name: "Do not email" }));
    expect(emailTab).not.toHaveAccessibleDescription();
    await user.click(infoTab);
    await user.clear(screen.getByLabelText("Display name"));
    await user.type(screen.getByLabelText("Display name"), sampleProfile.displayName);
    expect(infoTab).not.toHaveAccessibleDescription();
    expect(screen.queryByText("Unsaved", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
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
    expect(screen.getByRole("tab", { name: "Profile info" })).toHaveAccessibleDescription(
      "Unsaved",
    );
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    // Switch to Email & notifications tab
    const emailTab = screen.getByRole("tab", { name: "Email & notifications" });
    await user.click(emailTab);

    // Info tab is hidden but mounted (forceMount)
    expect(screen.getByText("Ready to upload: chosen-photo.jpg")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Profile info" })).toHaveAccessibleDescription(
      "Unsaved",
    );
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

  it("marks state as dirty, enables save button on folder changes, removes per-row save, and saves via main save button", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();

    render(<ProfileEditorHarness onSaved={onSaved} saveLabel="Save Profile" />);

    await user.click(screen.getByRole("button", { name: "Open Editor" }));
    expect(screen.getByRole("dialog", { name: "Edit Profile" })).toBeInTheDocument();

    // Switch to Folder numbers tab
    const foldersTab = screen.getByRole("tab", { name: "Folder numbers" });
    await user.click(foldersTab);

    // Initial folder row is rendered
    expect(await screen.findByDisplayValue("42")).toBeInTheDocument();
    expect(screen.getByText("Spring Gala")).toBeInTheDocument();

    // Pristine: No unsaved changes, Save button disabled
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: "Save Profile" });
    expect(saveButton).toBeDisabled();

    // Verify there are NO per-row save buttons
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    // Toggle "Folder returned" checkbox
    const returnedCheckbox = screen.getByRole("checkbox", { name: /Folder returned/i });
    expect(returnedCheckbox).not.toBeChecked();
    await user.click(returnedCheckbox);
    expect(returnedCheckbox).toBeChecked();
    expect(foldersTab).toHaveAccessibleDescription("Unsaved");
    expect(screen.getByRole("tab", { name: "Profile info" })).not.toHaveAccessibleDescription();

    // Dirty: State shows Unsaved changes and Save Profile button lights up (enabled)
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(saveButton).not.toBeDisabled();

    // Click main Save button
    await user.click(saveButton);

    expect(api.updateOrganizationProfile).toHaveBeenCalled();
    expect(api.updateOrganizationProfileFolderNumber).toHaveBeenCalledWith(
      sampleProfile.id,
      "event-1111",
      {
        folderNumber: "42",
        folderReturned: true,
      },
    );
    expect(onSaved).toHaveBeenCalled();

    // Dialog closes on success
    expect(screen.queryByRole("dialog", { name: "Edit Profile" })).not.toBeInTheDocument();
  });

  it("omits track-only voice parts from the profile editor selection", async () => {
    const user = userEvent.setup();
    const config: OrganizationRosterConfiguration = {
      attendanceReportWarningThreshold: 1,
      onBreakTimeoutDays: 365,
      onBreakTimeoutEnabled: true,
      performerLabel: "Performer",
      rehearsalAttendanceReportsEnabled: true,
      rsvpExpiryEnabled: true,
      rsvpFollowUpEnabled: true,
      rsvpFollowUpLeadHours: 48,
      sections: [
        { code: "T", color: "#2563eb", name: "Tenors", trackOnly: false },
        { code: "O", color: "#9333ea", name: "Other Tracks", trackOnly: true },
      ],
      statusAutomationEnabled: true,
      statusAutomationMissThreshold: 3,
      statusAutomationRecoveryEnabled: true,
      voiceParts: [
        { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
        { fullName: "SATB Reference", label: "SATB", sectionCode: "O" },
      ],
    };

    render(
      <ProfileEditorHarness
        rosterConfiguration={config}
        sampleToOpen={{ ...sampleProfile, voicePart: "T1" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open Editor" }));

    const voicePartSelect = screen.getByLabelText("Part");
    expect(
      within(voicePartSelect).getByRole("option", { name: "Tenor 1 (T1)" }),
    ).toBeInTheDocument();
    expect(within(voicePartSelect).queryByText(/SATB/)).not.toBeInTheDocument();
  });

  it("displays warning banner and disabled option for legacy track-only profile assignment", async () => {
    const user = userEvent.setup();
    const config: OrganizationRosterConfiguration = {
      attendanceReportWarningThreshold: 1,
      onBreakTimeoutDays: 365,
      onBreakTimeoutEnabled: true,
      performerLabel: "Performer",
      rehearsalAttendanceReportsEnabled: true,
      rsvpExpiryEnabled: true,
      rsvpFollowUpEnabled: true,
      rsvpFollowUpLeadHours: 48,
      sections: [
        { code: "T", color: "#2563eb", name: "Tenors", trackOnly: false },
        { code: "O", color: "#9333ea", name: "Other Tracks", trackOnly: true },
      ],
      statusAutomationEnabled: true,
      statusAutomationMissThreshold: 3,
      statusAutomationRecoveryEnabled: true,
      voiceParts: [
        { fullName: "Tenor 1", label: "T1", sectionCode: "T" },
        { fullName: "SATB Reference", label: "SATB", sectionCode: "O" },
      ],
    };

    render(
      <ProfileEditorHarness
        rosterConfiguration={config}
        sampleToOpen={{ ...sampleProfile, voicePart: "SATB" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Open Editor" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /configured as track-only for recordings and cannot be assigned to members/i,
    );
    const legacyOption = screen.getByRole("option", {
      name: /SATB Reference \(SATB\) \[Track-only — needs correction\]/,
    });
    expect(legacyOption).toBeInTheDocument();
    expect(legacyOption).toBeDisabled();
  });
});
