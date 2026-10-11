import { memberProfileSchema, type MemberProfile } from "@choir/contracts";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as profilesApi from "../api/profiles";
import { SaveBar, SaveCoordinatorProvider } from "../persistence";
import { MemberProfileDirectory } from "./MemberProfileDirectory";

vi.mock("../api/profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof profilesApi>();
  return {
    ...actual,
    getMemberProfile: vi.fn(),
    listOrganizationDirectory: vi.fn(),
    updateMemberProfile: vi.fn(),
  };
});

const memberProfile: MemberProfile = {
  displayName: "Casey Singer",
  email: "casey@example.test",
  globalStatus: "Active",
  id: "11111111-1111-4111-8111-111111111111",
  phone: "555-0100",
  photoFileId: null,
  receiveOtherEventReminders: true,
  receivePerformanceReminders: false,
  receiveRehearsalReminders: true,
  showInDirectory: true,
  voicePart: "S1",
};

async function setup() {
  render(
    <SaveCoordinatorProvider>
      <MemberProfileDirectory enabled view="profile" />
      <SaveBar />
    </SaveCoordinatorProvider>,
  );
  await screen.findByLabelText("Display name");
  return userEvent.setup();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(profilesApi.getMemberProfile).mockResolvedValue(memberProfile);
  vi.mocked(profilesApi.listOrganizationDirectory).mockResolvedValue([]);
  vi.mocked(profilesApi.updateMemberProfile).mockImplementation((draft) =>
    Promise.resolve(memberProfileSchema.parse({ ...memberProfile, ...draft })),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-photo");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

describe("MemberProfileDirectory profile photo dirty state", () => {
  it("treats a selected photo as unsaved changes until it is uploaded or discarded", async () => {
    const user = await setup();
    expect(screen.queryByLabelText("Unsaved changes")).not.toBeInTheDocument();

    const file = new File(["photo"], "profile-photo.jpg", { type: "image/jpeg" });
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput instanceof HTMLInputElement).toBe(true);
    if (fileInput instanceof HTMLInputElement) {
      await user.upload(fileInput, file);
    }

    expect(await screen.findByText(/Ready to upload: profile-photo\.jpg/)).toBeInTheDocument();
    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByText(/Ready to upload/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Unsaved changes")).not.toBeInTheDocument();
  });
});

describe("MemberProfileDirectory reminder preferences", () => {
  it("renders the preferences section with saved values and help text", async () => {
    await setup();
    expect(screen.getByRole("group", { name: "Email reminder preferences" })).toBeInTheDocument();
    expect(
      screen.getByText(/currently scheduled about 48 hours before an event/, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not change your RSVP/, { exact: false })).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Email reminder preferences" });
    expect(within(group).getByRole("checkbox", { name: /Rehearsal reminders/ })).toBeChecked();
    expect(
      within(group).getByRole("checkbox", { name: /Performance reminders/ }),
    ).not.toBeChecked();
    expect(within(group).getByRole("checkbox", { name: /Other Event reminders/ })).toBeChecked();
  });

  it("saves toggled preferences and shows the updated saved values", async () => {
    const user = await setup();
    const group = screen.getByRole("group", { name: "Email reminder preferences" });
    await user.click(within(group).getByRole("checkbox", { name: /Rehearsal reminders/ }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(profilesApi.updateMemberProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        receiveOtherEventReminders: true,
        receivePerformanceReminders: false,
        receiveRehearsalReminders: false,
      }),
    );
    expect(await screen.findByText("Your Organization Profile was updated.")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "Email reminder preferences" })).getByRole(
        "checkbox",
        { name: /Rehearsal reminders/ },
      ),
    ).not.toBeChecked();
  });
});
