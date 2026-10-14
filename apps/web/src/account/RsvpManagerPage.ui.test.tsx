import type {
  OrganizationAttendanceRow,
  OrganizationEvent,
  OrganizationProfile,
  OrganizationRosterConfiguration,
} from "@choir/contracts";
import { organizationEventSchema, organizationProfileSchema } from "@choir/contracts";
import { futureDateString, futureIsoDate } from "@choir/testkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RsvpManagerPage } from "./RsvpManagerPage";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("Unexpected api shape");
  return {
    ...actual,
    createOrganizationInvitation: vi.fn(() => Promise.resolve()),
    getOrganizationEventRsvpHistory: vi.fn(() => Promise.resolve({ entries: [] })),
    getOrganizationProfileDeliveries: vi.fn(() => Promise.resolve({ deliveries: [] })),
    getOrganizationProfileFolderNumbers: vi.fn(() => Promise.resolve([])),
    getOrganizationProfilePerformanceHistory: vi.fn(() =>
      Promise.resolve({ past: [], profileId: profileId1, upcoming: [] }),
    ),
    getOrganizationProfileStatusHistory: vi.fn(() =>
      Promise.resolve({ entries: [], profileId: profileId1 }),
    ),
    getOrganizationRosterConfiguration: vi.fn(() => Promise.resolve(mockRoster)),
    listOrganizationDues: vi.fn(() => Promise.resolve([])),
    listOrganizationEventAttendance: vi.fn(() => Promise.resolve(mockAttendance)),
    listOrganizationEvents: vi.fn(() => Promise.resolve(mockEvents)),
    listOrganizationMemberships: vi.fn(() =>
      Promise.resolve({ memberships: [], requestId: requestId, truncated: false }),
    ),
    listOrganizationProfiles: vi.fn(() => Promise.resolve(mockProfiles)),
    listOrganizationSeasons: vi.fn(() => Promise.resolve([])),
    requestPasswordReset: vi.fn(() => Promise.resolve()),
    updateOrganizationProfile: vi.fn(),
  };
});

import { listOrganizationProfiles, updateOrganizationProfile } from "../api";

const requestId = "99999999-9999-4999-8999-999999999999";
const eventId1 = "11111111-1111-4111-8111-111111111111";
const profileId1 = "33333333-3333-4333-8333-333333333331";
const profileId2 = "33333333-3333-4333-8333-333333333332";

const mockEvents: readonly OrganizationEvent[] = [
  organizationEventSchema.parse({
    callTime: "18:30",
    createdAt: "2026-08-01T00:00:00Z",
    details: "Winter Concert",
    endsAt: futureIsoDate({ days: 90, hours: 2 }),
    id: eventId1,
    location: "Main Hall",
    rsvpDeadlineDate: futureDateString({ days: 85 }),
    rsvpDeadlinePassed: false,
    startsAt: futureIsoDate({ days: 90 }),
    title: "Winter Concert",
    type: "Performance",
    updatedAt: "2026-08-01T00:00:00Z",
  }),
];

function makeProfile(id: string, displayName: string): OrganizationProfile {
  return organizationProfileSchema.parse({
    createdAt: "2026-08-01T00:00:00Z",
    displayName,
    globalStatus: "Active",
    id,
    updatedAt: "2026-08-01T00:00:00Z",
    voicePart: "S1",
  });
}

const mockProfiles: readonly OrganizationProfile[] = [
  makeProfile(profileId1, "Alice Singer"),
  makeProfile(profileId2, "Alicia Keys"),
];

const mockRoster: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Performer",
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [{ code: "S", color: "#1b4d3e", name: "Sopranos", trackOnly: false }],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [{ fullName: "Soprano 1", label: "S1", sectionCode: "S" }],
};

const mockAttendance: readonly OrganizationAttendanceRow[] = [
  {
    attendance: "Pending",
    displayName: "Alice Singer",
    profileId: profileId1,
    rsvp: "Yes",
    updatedAt: "2026-08-30T10:00:00Z",
    voicePart: "S1",
  },
  {
    attendance: "Pending",
    displayName: "Alicia Keys",
    profileId: profileId2,
    rsvp: "Pending",
    updatedAt: "2026-08-30T10:00:00Z",
    voicePart: "S1",
  },
];

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        networkMode: "always",
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity,
      },
    },
  });
}

function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (!item) throw new Error("Expected at least one element");
  return item;
}

function renderPage(canEditProfiles = true) {
  const queryClient = createTestQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RsvpManagerPage canEditProfiles={canEditProfiles} enabled eventId={eventId1} />
    </QueryClientProvider>,
  );
  return { queryClient, ...result };
}

beforeEach(() => {
  vi.mocked(updateOrganizationProfile).mockReset();
  vi.mocked(listOrganizationProfiles).mockResolvedValue(mockProfiles);
});

describe("RsvpManagerPage profile editor (issue #137)", () => {
  it("opens the correct profile by name button, saves with RSVP label, and returns focus with list state preserved", async () => {
    const user = userEvent.setup();
    const updated = makeProfile(profileId1, "Alice Renamed");
    vi.mocked(updateOrganizationProfile).mockResolvedValue(updated);

    renderPage();

    const search = await screen.findByPlaceholderText(/Name or part/i);
    await user.type(search, "Alice");
    const checkbox = first(await screen.findAllByRole("checkbox", { name: "Select Alice Singer" }));
    await user.click(checkbox);
    expect(checkbox).toBeChecked();

    const opener = first(
      await screen.findAllByRole("button", { name: "Open profile for Alice Singer" }),
    );
    await user.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Edit Profile" });
    expect(within(dialog).getByLabelText("Display name")).toHaveValue("Alice Singer");
    // All canonical tabs are present.
    expect(within(dialog).getByRole("tab", { name: "Profile info" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Email & notifications" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Performance RSVPs" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Dues" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Folder numbers" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Messages" })).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText("Display name"));
    await user.type(within(dialog).getByLabelText("Display name"), "Alice Renamed");
    await user.click(within(dialog).getByRole("button", { name: "Save & Return to RSVPs" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit Profile" })).not.toBeInTheDocument();
    });
    expect(vi.mocked(updateOrganizationProfile)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateOrganizationProfile).mock.calls[0]?.[0]).toBe(profileId1);
    // List continuity: search, selection, and focus restoration.
    expect(search).toHaveValue("Alice");
    expect(first(screen.getAllByRole("checkbox", { name: "Select Alice Singer" }))).toBeChecked();
    await waitFor(() => {
      expect(
        first(screen.getAllByRole("button", { name: "Open profile for Alice Singer" })),
      ).toHaveFocus();
    });
    expect(await screen.findByText("Profile updated.")).toBeInTheDocument();
  });

  it("opens a different singer with a similar name by stable profileId", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      first(await screen.findAllByRole("button", { name: "Open profile for Alicia Keys" })),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Profile" });
    expect(within(dialog).getByLabelText("Display name")).toHaveValue("Alicia Keys");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit Profile" })).not.toBeInTheDocument();
    });
    expect(vi.mocked(updateOrganizationProfile)).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with an error when save fails", async () => {
    const user = userEvent.setup();
    vi.mocked(updateOrganizationProfile).mockRejectedValue(new Error("boom"));
    renderPage();
    await user.click(
      first(await screen.findAllByRole("button", { name: "Open profile for Alice Singer" })),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Profile" });
    await user.type(within(dialog).getByLabelText("Display name"), " X");
    await user.click(within(dialog).getByRole("button", { name: "Save & Return to RSVPs" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The Profile could not be updated.",
    );
    expect(screen.getByRole("dialog", { name: "Edit Profile" })).toBeInTheDocument();
  });

  it("falls back to the search input for focus when a status change removes the opener from the filtered list", async () => {
    const user = userEvent.setup();
    let saved = false;
    const inactive = {
      ...makeProfile(profileId1, "Alice Singer"),
      globalStatus: "Inactive" as const,
    };
    vi.mocked(listOrganizationProfiles).mockImplementation(() =>
      Promise.resolve(saved ? [inactive, makeProfile(profileId2, "Alicia Keys")] : mockProfiles),
    );
    vi.mocked(updateOrganizationProfile).mockImplementation(() => {
      saved = true;
      return Promise.resolve(inactive);
    });
    renderPage();
    const search = await screen.findByPlaceholderText(/Name or part/i);
    await user.click(
      first(await screen.findAllByRole("button", { name: "Open profile for Alice Singer" })),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Profile" });
    // The API mock returns the profile as Inactive on save, so the row leaves
    // the Active-filtered RSVP list when bootstrap refetches.
    await user.click(within(dialog).getByRole("button", { name: "Save & Return to RSVPs" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Edit Profile" })).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(search).toHaveFocus();
    });
  });

  it("renders names as plain text when profile editing is not permitted", async () => {
    renderPage(false);
    await screen.findAllByText("Alice Singer");
    expect(
      screen.queryByRole("button", { name: "Open profile for Alice Singer" }),
    ).not.toBeInTheDocument();
    expect(first(screen.getAllByText("Alice Singer"))).toBeInTheDocument();
  });
});

describe("RsvpManagerPage toast feedback (#185)", () => {
  it("renders success feedback as floating toast with role='status' and dismiss button", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      first(await screen.findAllByRole("button", { name: "Open profile for Alice Singer" })),
    );
    const dialog = await screen.findByRole("dialog", { name: "Edit Profile" });
    await user.click(within(dialog).getByRole("button", { name: "Save & Return to RSVPs" }));

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Profile updated.");
    expect(toast.closest(".rsvp-toast-container")).toBeInTheDocument();

    const dismissButton = within(toast).getByRole("button", { name: "Dismiss notification" });
    await user.click(dismissButton);
    expect(screen.queryByText("Profile updated.")).not.toBeInTheDocument();
  });
});
