import type { OrganizationEvent, OrganizationVenue } from "@choir/contracts";
import { organizationEventSchema } from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../../api/queryKeys";
import { EventsPage } from "./page";
import { resetEventEditorMocks } from "./EventEditorDialog/testHarness";

vi.mock("../../../auth/api", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("Unexpected auth api shape");
  return {
    ...actual,
    createOrganizationVenue: vi.fn(),
    getOrganizationBranding: vi.fn(),
    getOrganizationCalendarSettings: vi.fn(),
    getOrganizationProviderStatus: vi.fn(),
    getOrganizationRosterConfiguration: vi.fn(),
    listOrganizationCommunicationTemplates: vi.fn(),
    listOrganizationEventPromotionMessages: vi.fn(),
    listOrganizationEvents: vi.fn(),
    listOrganizationVenues: vi.fn(),
    updateOrganizationEvent: vi.fn(),
  };
});

vi.mock("../../../api", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("Unexpected api shape");
  return {
    ...actual,
    getOrganizationRosterConfiguration: vi.fn(),
    listOrganizationContactLists: vi.fn(),
    listOrganizationEventAttendance: vi.fn(),
    listOrganizationProfiles: vi.fn(),
    previewOrganizationCommunicationReach: vi.fn(),
  };
});

import {
  getOrganizationCalendarSettings,
  getOrganizationRosterConfiguration as getAuthRosterConfiguration,
  listOrganizationEvents,
  listOrganizationVenues,
  updateOrganizationEvent,
} from "../../../auth/api";

const venueId = "22222222-2222-4222-8222-222222222222";
const perfId = "11111111-1111-4111-8111-111111111111";
const otherId = "33333333-3333-4333-8333-333333333333";
const rehearsalId = "44444444-4444-4444-8444-444444444444";

const venue: OrganizationVenue = {
  address: "1 Hall Way",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: venueId,
  name: "City Concert Hall",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const performanceEvent: OrganizationEvent = organizationEventSchema.parse({
  callTime: "18:30",
  createdAt: "2026-01-01T00:00:00.000Z",
  details: "Holiday Parade performance",
  id: perfId,
  location: venue.name,
  rsvpDeadlineDate: "2026-11-16",
  rsvpDeadlinePassed: false,
  startsAt: "2026-11-21T15:00:00.000Z",
  title: "2026 Holiday Parade",
  type: "Performance",
  updatedAt: "2026-01-01T00:00:00.000Z",
  venueId,
});

const otherEvent: OrganizationEvent = organizationEventSchema.parse({
  callTime: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  details: "Community outreach social",
  id: otherId,
  location: venue.name,
  otherEventAudience: { type: "everyone" },
  otherEventRsvpMode: "optional",
  otherEventStaffingGoal: null,
  rsvpDeadlineDate: null,
  rsvpDeadlinePassed: false,
  startsAt: "2026-12-05T19:00:00.000Z",
  title: "Community Social",
  type: "Other",
  updatedAt: "2026-01-01T00:00:00.000Z",
  venueId,
});

const rehearsalEvent: OrganizationEvent = organizationEventSchema.parse({
  callTime: "18:45",
  createdAt: "2026-01-01T00:00:00.000Z",
  details: "Weekly rehearsal",
  id: rehearsalId,
  location: venue.name,
  parentPerformanceId: perfId,
  rsvpDeadlineDate: null,
  rsvpDeadlinePassed: false,
  startsAt: "2026-11-14T23:00:00.000Z",
  title: "Parade Rehearsal",
  type: "Rehearsal",
  updatedAt: "2026-01-01T00:00:00.000Z",
  venueId,
});

beforeEach(() => {
  resetEventEditorMocks();
  vi.mocked(listOrganizationEvents).mockResolvedValue([
    performanceEvent,
    otherEvent,
    rehearsalEvent,
  ]);
  vi.mocked(listOrganizationVenues).mockResolvedValue([venue]);
  vi.mocked(getOrganizationCalendarSettings).mockResolvedValue({
    timezone: "America/New_York",
  });
  vi.mocked(getAuthRosterConfiguration).mockResolvedValue({
    attendanceReportWarningThreshold: 1,
    onBreakTimeoutDays: 365,
    onBreakTimeoutEnabled: true,
    performerLabel: "Performer",
    rehearsalAttendanceReportsEnabled: true,
    rosterStructure: "sections_only",
    rsvpExpiryEnabled: true,
    rsvpFollowUpEnabled: true,
    rsvpFollowUpLeadHours: 48,
    sections: [{ code: "S", color: "#123456", name: "Soprano", trackOnly: false }],
    statusAutomationEnabled: true,
    statusAutomationMissThreshold: 3,
    statusAutomationRecoveryEnabled: true,
    voiceParts: [{ fullName: "Soprano", label: "S", sectionCode: "S" }],
  });
  vi.mocked(updateOrganizationEvent).mockReset();
});

describe("EventsPage RSVP deep-link and returnTo round-trip", () => {
  it("opens Performance event to RSVP section, invalidates RSVP queries on save, and returns to /admin/rsvp", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const updatedEvent: OrganizationEvent = {
      ...performanceEvent,
      rsvpDeadlineDate: "2026-11-18",
    };
    vi.mocked(updateOrganizationEvent).mockResolvedValue(updatedEvent);

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <EventsPage
          enabled
          initialEventId={perfId}
          initialSection="rsvp"
          navigate={navigate}
          returnTo={`/admin/rsvp?eventId=${perfId}`}
        />
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Edit event" });
    expect(within(dialog).getByRole("tab", { name: /RSVPs & reminders/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(dialog).getByRole("button", { name: "Back to RSVPs" })).toBeInTheDocument();

    const deadlineInput = within(dialog).getByLabelText(/Member RSVP deadline/);
    await user.clear(deadlineInput);
    await user.type(deadlineInput, "2026-11-18");

    await user.click(within(dialog).getByRole("button", { name: "Save event" }));

    await waitFor(() => {
      expect(vi.mocked(updateOrganizationEvent)).toHaveBeenCalledWith(
        perfId,
        expect.objectContaining({ rsvpDeadlineDate: "2026-11-18" }),
      );
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.organization.rsvpBootstrap,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.organization.attendance(perfId),
    });
    expect(navigate).toHaveBeenCalledWith(`/admin/rsvp?eventId=${perfId}`);
  });

  it("opens Other event to RSVP section and returns to /admin/rsvp when Back to RSVPs is clicked", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <EventsPage
          enabled
          initialEventId={otherId}
          initialSection="rsvp"
          navigate={navigate}
          returnTo={`/admin/rsvp?eventId=${otherId}`}
        />
      </QueryClientProvider>,
    );

    const dialog = await screen.findByRole("dialog", { name: "Edit event" });
    expect(within(dialog).getByRole("tab", { name: /RSVPs & reminders/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(dialog).getByLabelText("RSVP mode")).toHaveValue("optional");

    await user.click(within(dialog).getByRole("button", { name: "Back to RSVPs" }));
    expect(navigate).toHaveBeenCalledWith(`/admin/rsvp?eventId=${otherId}`);
  });

  it("renders recoverable alert and ← Back to RSVPs link for missing or Rehearsal events", async () => {
    const navigate = vi.fn();

    const { unmount } = render(
      <QueryClientProvider client={new QueryClient()}>
        <EventsPage
          enabled
          initialEventId={rehearsalId}
          initialSection="rsvp"
          navigate={navigate}
          returnTo="/admin/rsvp"
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Rehearsals do not have separate RSVP settings.",
    );
    expect(screen.queryByRole("dialog", { name: "Edit event" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to RSVPs" })).toHaveAttribute(
      "href",
      "/admin/rsvp",
    );

    unmount();

    render(
      <QueryClientProvider client={new QueryClient()}>
        <EventsPage
          enabled
          initialEventId="00000000-0000-4000-8000-000000000000"
          initialSection="rsvp"
          navigate={navigate}
          returnTo="/admin/rsvp"
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be found");
    expect(screen.getByRole("link", { name: "← Back to RSVPs" })).toBeInTheDocument();
  });
});
