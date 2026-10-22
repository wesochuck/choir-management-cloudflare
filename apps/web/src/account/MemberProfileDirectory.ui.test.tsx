import { memberProfileSchema, type MemberProfile } from "@choir/contracts";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthApiError } from "../api";
import * as filesApi from "../api/files";
import * as profilesApi from "../api/profiles";
import { SaveBar, SaveCoordinatorProvider } from "../persistence";
import { MemberProfileDirectory } from "./MemberProfileDirectory";

vi.mock("../api/files", async (importOriginal) => {
  const actual = await importOriginal<typeof filesApi>();
  return {
    ...actual,
    deletePrivateOrganizationFile: vi.fn(),
    uploadPrivateOrganizationFile: vi.fn(),
  };
});

vi.mock("../api/profiles", async (importOriginal) => {
  const actual = await importOriginal<typeof profilesApi>();
  return {
    ...actual,
    getMemberProfile: vi.fn(),
    listOrganizationDirectory: vi.fn(),
    requestMemberEmailChange: vi.fn(),
    setOrganizationProfilePhoto: vi.fn(),
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
  showEmailInDirectory: true,
  showPhoneInDirectory: true,
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
  vi.mocked(filesApi.uploadPrivateOrganizationFile).mockResolvedValue({
    contentType: "image/jpeg",
    fileName: "profile-photo.jpg",
    id: "uploaded-photo-file-id",
    requestId: "req-1",
    sizeBytes: 100,
    uploadedAt: new Date().toISOString(),
  });
  vi.mocked(profilesApi.setOrganizationProfilePhoto).mockResolvedValue(undefined);
  vi.mocked(profilesApi.getMemberProfile).mockResolvedValue(memberProfile);
  vi.mocked(profilesApi.listOrganizationDirectory).mockResolvedValue([]);
  vi.mocked(profilesApi.updateMemberProfile).mockImplementation((draft) =>
    Promise.resolve(memberProfileSchema.parse({ ...memberProfile, ...draft })),
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-photo");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});

describe("directory contact visibility", () => {
  it("saves independent choices and retains them while directory listing is disabled", async () => {
    const user = await setup();
    const email = screen.getByRole("checkbox", { name: "Show my email in the directory" });
    const phone = screen.getByRole("checkbox", { name: "Show my phone number in the directory" });
    expect(email).toBeChecked();
    expect(phone).toBeChecked();
    await user.click(email);
    expect(phone).toBeChecked();
    await user.click(
      screen.getByRole("checkbox", { name: "List me in the Organization member directory" }),
    );
    expect(email).toBeDisabled();
    expect(phone).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: "List me in the Organization member directory" }),
    );
    expect(email).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      expect(profilesApi.updateMemberProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          showInDirectory: true,
          showEmailInDirectory: false,
          showPhoneInDirectory: true,
        }),
      );
    });
    expect(screen.getByText("Current sign-in email:").parentElement).toHaveTextContent(
      "casey@example.test",
    );
  });
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

  it("saves pending photo and profile field edits together via SaveBar and clears dirty state", async () => {
    const user = await setup();

    const nameInput = screen.getByLabelText("Display name");
    await user.clear(nameInput);
    await user.type(nameInput, "Casey Singer Updated");

    const file = new File(["photo bytes"], "profile-photo.jpg", { type: "image/jpeg" });
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput instanceof HTMLInputElement).toBe(true);
    if (fileInput instanceof HTMLInputElement) {
      await user.upload(fileInput, file);
    }

    expect(screen.getByLabelText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(profilesApi.updateMemberProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: "Casey Singer Updated",
      }),
    );
    expect(filesApi.uploadPrivateOrganizationFile).toHaveBeenCalledWith(file);
    expect(profilesApi.setOrganizationProfilePhoto).toHaveBeenCalledWith(
      memberProfile.id,
      "uploaded-photo-file-id",
    );
    await waitFor(() => {
      expect(screen.queryByLabelText("Unsaved changes")).not.toBeInTheDocument();
    });
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

describe("MemberProfileDirectory admin return banner", () => {
  beforeEach(() => {
    vi.mocked(profilesApi.listOrganizationDirectory).mockResolvedValue([
      {
        displayName: "Casey Singer",
        email: "casey@example.test",
        id: "1",
        phone: "555-0100",
        photoFileId: null,
        voicePart: "S1",
      },
    ]);
  });

  it("renders admin return banner when adminReturnTo is provided and navigates on click", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(
      <MemberProfileDirectory
        adminReturnTo="/admin/roster"
        enabled
        navigate={navigate}
        view="directory"
      />,
    );

    const banner = await screen.findByRole("complementary", { name: "Admin navigation context" });
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Viewing member Directory");
    expect(banner).toHaveTextContent("Back to Admin");

    const returnLink = within(banner).getByRole("link", { name: "Back to Admin" });
    expect(returnLink).toHaveAttribute("href", "/admin/roster");

    await user.click(returnLink);
    expect(navigate).toHaveBeenCalledWith("/admin/roster");
  });

  it("does not render admin return banner when adminReturnTo is omitted or null", async () => {
    render(<MemberProfileDirectory enabled view="directory" />);

    await screen.findByRole("region", { name: "Organization directory" });
    expect(screen.queryByRole("complementary", { name: "Admin navigation context" })).toBeNull();
    expect(screen.queryByText("Back to Admin")).toBeNull();
  });
});

describe("MemberProfileDirectory part filter coverage and privacy (#197)", () => {
  beforeEach(() => {
    vi.mocked(profilesApi.listOrganizationDirectory).mockResolvedValue([
      {
        displayName: "Alice Soprano",
        email: "alice@example.test",
        id: "1",
        phone: "555-0101",
        photoFileId: null,
        voicePart: "S2",
      },
      {
        displayName: "Bob Alto",
        email: "bob@example.test",
        id: "2",
        phone: "555-0102",
        photoFileId: null,
        voicePart: "A2",
      },
      {
        displayName: "Charlie Tenor",
        email: "charlie@example.test",
        id: "3",
        phone: "555-0103",
        photoFileId: null,
        voicePart: "T2",
      },
    ]);
  });

  it("lists only voice parts with visible members and displays explanatory field help", async () => {
    render(<MemberProfileDirectory enabled view="directory" />);

    const select = await screen.findByRole("combobox", { name: /^Part$/i });
    expect(select).toBeInTheDocument();
    expect(select).toHaveAttribute("aria-describedby", "directory-part-filter-help");
    expect(select).toBeInstanceOf(HTMLSelectElement);
    if (!(select instanceof HTMLSelectElement)) {
      throw new Error("Expected HTMLSelectElement");
    }

    const help = screen.getByText("Only parts with listed members appear.");
    expect(help).toBeInTheDocument();
    expect(help).toHaveAttribute("id", "directory-part-filter-help");

    const options = Array.from(select.options).map((opt) => opt.value);
    expect(options).toEqual(["", "A2", "S2", "T2"]);
    expect(options).not.toContain("S1");
    expect(options).not.toContain("B1");
  });

  it("filters directory profiles when a voice part is selected", async () => {
    const user = userEvent.setup();
    render(<MemberProfileDirectory enabled view="directory" />);

    const select = await screen.findByRole("combobox", { name: /^Part$/i });
    expect(screen.getByText("Alice Soprano")).toBeInTheDocument();
    expect(screen.getByText("Bob Alto")).toBeInTheDocument();
    expect(screen.getByText("Charlie Tenor")).toBeInTheDocument();

    await user.selectOptions(select, "A2");

    expect(screen.queryByText("Alice Soprano")).toBeNull();
    expect(screen.getByText("Bob Alto")).toBeInTheDocument();
    expect(screen.queryByText("Charlie Tenor")).toBeNull();
  });
});

describe("MemberProfileDirectory email-change verification (#198)", () => {
  beforeEach(() => {
    vi.mocked(profilesApi.getMemberProfile).mockResolvedValue(memberProfile);
    vi.mocked(profilesApi.requestMemberEmailChange).mockReset();
  });

  it("associates field help with aria-describedby and describes verification expectations", async () => {
    await setup();

    const emailInput = await screen.findByLabelText("New sign-in email");
    expect(emailInput).toHaveAttribute("aria-describedby", "member-email-help");

    const help = screen.getByText(
      /We'll send a confirmation link there and a security notice to your current address/i,
    );
    expect(help).toBeInTheDocument();
    expect(help).toHaveAttribute("id", "member-email-help");
    expect(help).toHaveTextContent(/stays on your current address until confirmed/i);
    expect(help).toHaveTextContent(/updates where you receive choir communications/i);
  });

  it("validates empty email or missing @ with an alert before submitting", async () => {
    const user = userEvent.setup();
    await setup();

    const emailInput = await screen.findByLabelText("New sign-in email");
    await user.clear(emailInput);

    const changeButton = screen.getByRole("button", { name: "Change email" });
    await user.click(changeButton);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Enter a valid new email address.");
    expect(profilesApi.requestMemberEmailChange).not.toHaveBeenCalled();
  });

  it("prevents requesting a change to the existing sign-in email address", async () => {
    const user = userEvent.setup();
    await setup();

    const emailInput = await screen.findByLabelText("New sign-in email");
    expect(emailInput).toHaveValue(memberProfile.email);

    const changeButton = screen.getByRole("button", { name: "Change email" });
    await user.click(changeButton);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Choose a different email address before requesting a change.");
    expect(profilesApi.requestMemberEmailChange).not.toHaveBeenCalled();
  });

  it("successfully requests email change, displays destination details, and disables duplicate submission", async () => {
    const user = userEvent.setup();
    const newAddress = "casey.new@example.test";
    vi.mocked(profilesApi.requestMemberEmailChange).mockResolvedValue(newAddress);

    await setup();

    const emailInput = await screen.findByLabelText("New sign-in email");
    await user.clear(emailInput);
    await user.type(emailInput, newAddress);

    const changeButton = screen.getByRole("button", { name: "Change email" });
    await user.click(changeButton);

    expect(profilesApi.requestMemberEmailChange).toHaveBeenCalledWith(newAddress);

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(`We sent a confirmation link to ${newAddress}`);
    expect(status).toHaveTextContent("within 30 minutes");
    expect(status).toHaveTextContent("Your current sign-in remains active until confirmed");
    expect(status).toHaveTextContent("enter a different address above or let the link expire");

    // Button updates and is disabled to avoid repeated submissions for the pending address
    const sentButton = screen.getByRole("button", { name: "Confirmation link sent" });
    expect(sentButton).toBeDisabled();

    // Changing the input resets the button back to enabled "Change email"
    await user.type(emailInput, "2");
    expect(screen.getByRole("button", { name: "Change email" })).not.toBeDisabled();
  });

  it("displays server error message when request fails", async () => {
    const user = userEvent.setup();
    vi.mocked(profilesApi.requestMemberEmailChange).mockRejectedValue(
      new AuthApiError(
        "That email address is already in use by another account.",
        409,
        "email_in_use",
      ),
    );

    await setup();

    const emailInput = await screen.findByLabelText("New sign-in email");
    await user.clear(emailInput);
    await user.type(emailInput, "taken@example.test");

    const changeButton = screen.getByRole("button", { name: "Change email" });
    await user.click(changeButton);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That email address is already in use by another account.");
  });
});
