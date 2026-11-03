import type {
  OrganizationAttendanceRow,
  OrganizationEventRequest,
  OrganizationProfile,
} from "@choir/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SetStateAction } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEditorDialog } from "./dialogs";
import {
  resetEventEditorMocks,
  stateWithVenues,
  switchToSection,
  venueHall,
} from "./EventEditorDialog/testHarness";
import { emptyEvent } from "./utils";

vi.mock("../../../auth/api", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("Unexpected auth api shape");
  return {
    ...actual,
    createOrganizationVenue: vi.fn(),
    getOrganizationBranding: vi.fn(),
    getOrganizationProviderStatus: vi.fn(),
    listOrganizationCommunicationTemplates: vi.fn(),
    listOrganizationEventPromotionMessages: vi.fn(),
    listOrganizationVenues: vi.fn(),
  };
});

vi.mock("../../../api", async (importOriginal) => {
  const actual = await importOriginal();
  if (typeof actual !== "object" || actual === null) throw new Error("Unexpected api shape");
  return {
    ...actual,
    getOrganizationRosterConfiguration: vi.fn(),
    listOrganizationEventAttendance: vi.fn(),
    listOrganizationContactLists: vi.fn(),
    listOrganizationProfiles: vi.fn(),
    previewOrganizationCommunicationReach: vi.fn(),
  };
});

import {
  listOrganizationEventAttendance,
  listOrganizationProfiles,
  previewOrganizationCommunicationReach,
} from "../../../api";

beforeEach(() => {
  resetEventEditorMocks();
});

const sampleActiveProfiles: readonly OrganizationProfile[] = [
  {
    bounceReason: "",
    createdAt: "2026-01-01T00:00:00Z",
    displayName: "Alice Smith",
    doNotEmail: false,
    email: "alice@example.com",
    globalStatus: "Active",
    hidden: false,
    id: "11111111-1111-4111-8111-111111111111",
    isSectionLeader: false,
    lastBounceAt: "",
    notes: "",
    onBreakInactiveAt: null,
    phone: "",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveAdminNotifications: false,
    receiveAttendanceReports: true,
    receiveAuditionNotifications: false,
    receiveFinancialAlerts: false,
    receiveOtherEventReminders: true,
    receivePerformanceReminders: true,
    receiveRehearsalReminders: true,
    receiveRsvpDeclineNotices: false,
    showEmailInDirectory: true,
    showInDirectory: true,
    showPhoneInDirectory: true,
    statusChangedAt: "2026-01-01T00:00:00Z",
    statusChangeReason: "",
    statusIsManual: false,
    updatedAt: "2026-01-01T00:00:00Z",
    voicePart: "Soprano",
  },
  {
    bounceReason: "",
    createdAt: "2026-01-01T00:00:00Z",
    displayName: "Bob Jones",
    doNotEmail: false,
    email: "bob@example.com",
    globalStatus: "Active",
    hidden: false,
    id: "22222222-2222-4222-8222-222222222222",
    isSectionLeader: false,
    lastBounceAt: "",
    notes: "",
    onBreakInactiveAt: null,
    phone: "",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveAdminNotifications: false,
    receiveAttendanceReports: true,
    receiveAuditionNotifications: false,
    receiveFinancialAlerts: false,
    receiveOtherEventReminders: true,
    receivePerformanceReminders: true,
    receiveRehearsalReminders: true,
    receiveRsvpDeclineNotices: false,
    showEmailInDirectory: true,
    showInDirectory: true,
    showPhoneInDirectory: true,
    statusChangedAt: "2026-01-01T00:00:00Z",
    statusChangeReason: "",
    statusIsManual: false,
    updatedAt: "2026-01-01T00:00:00Z",
    voicePart: "Bass",
  },
  {
    bounceReason: "",
    createdAt: "2026-01-01T00:00:00Z",
    displayName: "Charlie Brown",
    doNotEmail: false,
    email: "charlie@example.com",
    globalStatus: "Active",
    hidden: false,
    id: "33333333-3333-4333-8333-333333333333",
    isSectionLeader: false,
    lastBounceAt: "",
    notes: "",
    onBreakInactiveAt: null,
    phone: "",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveAdminNotifications: false,
    receiveAttendanceReports: true,
    receiveAuditionNotifications: false,
    receiveFinancialAlerts: false,
    receiveOtherEventReminders: true,
    receivePerformanceReminders: true,
    receiveRehearsalReminders: true,
    receiveRsvpDeclineNotices: false,
    showEmailInDirectory: true,
    showInDirectory: true,
    showPhoneInDirectory: true,
    statusChangedAt: "2026-01-01T00:00:00Z",
    statusChangeReason: "",
    statusIsManual: false,
    updatedAt: "2026-01-01T00:00:00Z",
    voicePart: "Tenor",
  },
  {
    bounceReason: "",
    createdAt: "2026-01-01T00:00:00Z",
    displayName: "Inactive Singer",
    doNotEmail: false,
    email: "inactive@example.com",
    globalStatus: "Inactive",
    hidden: false,
    id: "44444444-4444-4444-8444-444444444444",
    isSectionLeader: false,
    lastBounceAt: "",
    notes: "",
    onBreakInactiveAt: null,
    phone: "",
    photoFileId: null,
    providerEmailSuppressed: false,
    receiveAdminNotifications: false,
    receiveAttendanceReports: true,
    receiveAuditionNotifications: false,
    receiveFinancialAlerts: false,
    receiveOtherEventReminders: true,
    receivePerformanceReminders: true,
    receiveRehearsalReminders: true,
    receiveRsvpDeclineNotices: false,
    showEmailInDirectory: true,
    showInDirectory: true,
    showPhoneInDirectory: true,
    statusChangedAt: "2026-01-01T00:00:00Z",
    statusChangeReason: "",
    statusIsManual: false,
    updatedAt: "2026-01-01T00:00:00Z",
    voicePart: "Alto",
  },
];

describe("EventEditorDialog Other event RSVP and reminders layout", () => {
  it("renders RSVPs & reminders section for Other events with optional badge and correct panels", async () => {
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      type: "Other",
      title: "Social Gathering",
      venueId: venueHall.id,
      otherEventRsvpMode: "off",
    };
    const setEvent = vi.fn((change: SetStateAction<OrganizationEventRequest>) => {
      draft = typeof change === "function" ? change(draft) : change;
    });

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    expect(screen.getByRole("tab", { name: /Basics/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Schedule & venue/ })).toBeInTheDocument();
    const rsvpTab = screen.getByRole("tab", { name: /RSVPs & reminders/ });
    expect(rsvpTab).toBeInTheDocument();
    expect(rsvpTab).toHaveTextContent("Optional");
    expect(screen.queryByRole("tab", { name: /Ticket sales/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Public content/ })).not.toBeInTheDocument();

    await switchToSection(/RSVPs & reminders/);
    expect(
      await screen.findByRole("heading", { level: 3, name: "RSVPs & reminders" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("RSVP mode")).toBeInTheDocument();
    expect(screen.getByLabelText(/Everyone/)).toBeInTheDocument();
  });

  it("updates RSVP mode, staffing goal, and reminder emails for Other events", async () => {
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      type: "Other",
      title: "Choir Banquet",
      venueId: venueHall.id,
      otherEventRsvpMode: "off",
    };
    const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
      draft = typeof change === "function" ? change(draft) : change;
    };

    const { rerender } = render(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/RSVPs & reminders/);
    expect(screen.queryByLabelText("Minimum staffing goal")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("RSVP mode"), "optional");
    expect(draft.otherEventRsvpMode).toBe("optional");

    rerender(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    const staffingGoal = screen.getByLabelText("Minimum staffing goal");
    expect(staffingGoal).toBeInTheDocument();
    await user.type(staffingGoal, "10");
    expect(draft.otherEventStaffingGoal).toBe(10);

    await user.selectOptions(screen.getByLabelText("RSVP mode"), "response_requested");
    expect(draft.otherEventRsvpMode).toBe("response_requested");

    rerender(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    expect(screen.getByText("Automated RSVP reminder email")).toBeInTheDocument();
    const eventSetting = screen.getByLabelText("Event setting");
    expect(eventSetting).toBeInTheDocument();
    await user.selectOptions(eventSetting, "enabled");
    expect(draft.rsvpFollowUpMode).toBe("enabled");
  });

  it("hides Ticket sales and Public content and allows switching to RSVPs & reminders when event type is changed to Other", async () => {
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      type: "Performance",
      title: "Concert",
      venueId: venueHall.id,
      isTicketingEnabled: true,
    };
    const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
      draft = typeof change === "function" ? change(draft) : change;
    };

    const { rerender } = render(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    expect(screen.getByRole("tab", { name: /Ticket sales/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Public content/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Type *"), "Other");
    expect(draft.type).toBe("Other");

    rerender(
      <EventEditorDialog
        busy={false}
        dialogOpen
        editingId={null}
        error={null}
        event={draft}
        eventStart="2027-11-15T19:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={setEvent}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    expect(screen.queryByRole("tab", { name: /Ticket sales/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Public content/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /RSVPs & reminders/ })).toBeInTheDocument();

    await switchToSection(/RSVPs & reminders/);
    expect(
      await screen.findByRole("heading", { level: 3, name: "RSVPs & reminders" }),
    ).toBeInTheDocument();
  });
});

describe("EventEditorDialog Targeted Audience member combobox and chips", () => {
  it("allows searching and selecting members into chips, removing chips, and clearing all chips", async () => {
    vi.mocked(listOrganizationProfiles).mockResolvedValue([...sampleActiveProfiles]);
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      otherEventAudience: {
        profileIds: [],
        type: "targeted",
        voiceParts: [],
      },
      title: "Committee Meeting",
      type: "Other",
      venueId: venueHall.id,
    };

    const Harness = () => {
      const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
        draft = typeof change === "function" ? change(draft) : change;
      };
      return (
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId={null}
          error={null}
          event={draft}
          eventStart="2026-11-20T18:00"
          graphicFile={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={setEvent}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />
      );
    };

    const { rerender } = render(<Harness />);
    await switchToSection(/RSVPs & reminders/);

    const combobox = await screen.findByRole("combobox", { name: "Search specific members" });
    expect(combobox).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "0 members selected in targeted audience",
    );

    // Search for Alice Smith
    await user.click(combobox);
    await user.type(combobox, "Alice");

    const aliceOption = await screen.findByRole("option", { name: /Alice Smith/ });
    expect(aliceOption).toBeInTheDocument();
    expect(aliceOption).toHaveTextContent("Soprano");
    await user.click(aliceOption);

    rerender(<Harness />);

    // Alice should be added as a chip and combobox input should be cleared
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(combobox).toHaveValue("");
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "1 member selected in targeted audience",
    );

    // Clear all should NOT be visible with only 1 chip
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();

    // Search and add Bob Jones
    await user.click(combobox);
    await user.type(combobox, "Bob");

    const bobOption = await screen.findByRole("option", { name: /Bob Jones/ });
    await user.click(bobOption);

    rerender(<Harness />);

    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "2 members selected in targeted audience",
    );

    // Clear all should be visible with multiple chips
    const clearAllBtn = screen.getByRole("button", { name: "Clear all" });
    expect(clearAllBtn).toBeInTheDocument();

    // Remove Alice Smith via individual chip remove button
    const removeAliceBtn = screen.getByRole("button", { name: "Remove Alice Smith" });
    await user.click(removeAliceBtn);

    rerender(<Harness />);

    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "1 member selected in targeted audience",
    );
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();

    // Add Charlie Brown
    await user.click(combobox);
    await user.type(combobox, "Charlie");
    const charlieOption = await screen.findByRole("option", { name: /Charlie Brown/ });
    await user.click(charlieOption);

    rerender(<Harness />);

    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText("Charlie Brown")).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "2 members selected in targeted audience",
    );

    // Click Clear all to remove all chips
    await user.click(screen.getByRole("button", { name: "Clear all" }));

    rerender(<Harness />);

    expect(screen.queryByText("Bob Jones")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie Brown")).not.toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "0 members selected in targeted audience",
    );
  });

  it("excludes already selected members from autocomplete options", async () => {
    vi.mocked(listOrganizationProfiles).mockResolvedValue([...sampleActiveProfiles]);
    const user = userEvent.setup();
    const draft: OrganizationEventRequest = {
      ...emptyEvent,
      otherEventAudience: {
        profileIds: ["11111111-1111-4111-8111-111111111111"], // Alice Smith
        type: "targeted",
        voiceParts: [],
      },
      title: "Committee Meeting",
      type: "Other",
      venueId: venueHall.id,
    };

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={draft}
        eventStart="2026-11-20T18:00"
        graphicFile={null}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );
    await switchToSection(/RSVPs & reminders/);

    const combobox = await screen.findByRole("combobox", { name: "Search specific members" });
    // Alice is already a chip
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();

    // Focus combobox and trigger listbox via Down Arrow
    await user.click(combobox);
    await user.keyboard("{ArrowDown}");

    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();

    // Bob and Charlie should be in the listbox options, but NOT Alice
    const options = screen.getAllByRole("option");
    const optionLabels = options.map((opt) => opt.textContent);
    expect(optionLabels.some((label) => label.includes("Bob Jones"))).toBe(true);
    expect(optionLabels.some((label) => label.includes("Charlie Brown"))).toBe(true);
    expect(optionLabels.some((label) => label.includes("Alice Smith"))).toBe(false);
  });

  it("deduplicates audience counter when member is covered by both voice part and specific selection", async () => {
    vi.mocked(listOrganizationProfiles).mockResolvedValue([...sampleActiveProfiles]);
    const user = userEvent.setup();
    let draft: OrganizationEventRequest = {
      ...emptyEvent,
      otherEventAudience: {
        profileIds: [],
        type: "targeted",
        voiceParts: ["Soprano"],
      },
      title: "Soprano Sectional",
      type: "Other",
      venueId: venueHall.id,
    };

    const Harness = () => {
      const setEvent = (change: SetStateAction<OrganizationEventRequest>) => {
        draft = typeof change === "function" ? change(draft) : change;
      };
      return (
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId={null}
          error={null}
          event={draft}
          eventStart="2026-11-20T18:00"
          graphicFile={null}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={setEvent}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />
      );
    };

    const { rerender } = render(<Harness />);
    await switchToSection(/RSVPs & reminders/);

    const combobox = await screen.findByRole("combobox", { name: "Search specific members" });

    // Since Soprano is checked, Alice (Soprano) is already counted
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "1 member selected in targeted audience",
    );

    // Add Alice Smith as a specific member as well
    await user.click(combobox);
    await user.type(combobox, "Alice");
    const aliceOption = await screen.findByRole("option", { name: /Alice Smith/ });
    await user.click(aliceOption);

    rerender(<Harness />);

    // Count remains 1 because Alice was already counted via Soprano
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "1 member selected in targeted audience",
    );

    // Add Bob Jones (Bass)
    await user.click(combobox);
    await user.type(combobox, "Bob");
    const bobOption = await screen.findByRole("option", { name: /Bob Jones/ });
    await user.click(bobOption);

    rerender(<Harness />);

    // Count increases to 2
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expect(screen.getByText(/selected in targeted audience/)).toHaveTextContent(
      "2 members selected in targeted audience",
    );
  });
});

describe("EventEditorDialog RSVP response summary and navigation", () => {
  beforeEach(() => {
    const base = sampleActiveProfiles[0];
    if (!base) throw new Error("Missing profile fixture");
    vi.mocked(listOrganizationProfiles).mockResolvedValue(
      [1, 2, 3, 4].map((number) => ({ ...base, id: `profile-${String(number)}` })),
    );
    vi.mocked(previewOrganizationCommunicationReach).mockResolvedValue({
      audienceOverLimit: false,
      both: 0,
      email: 1,
      sms: 0,
      total: 1,
      unreachable: 0,
      ticketBuyerPurchasesOverLimit: 0,
      undeliverableTicketBuyerPurchases: 0,
    });
  });
  const savedPerformance: OrganizationEventRequest = {
    ...emptyEvent,
    title: "Saved Gala",
    type: "Performance",
    venueId: venueHall.id,
  };

  const sampleAttendance: readonly OrganizationAttendanceRow[] = [
    {
      attendance: "Pending",
      displayName: "Alice Singer",
      profileId: "profile-1",
      rsvp: "Yes",
      updatedAt: "2026-03-01T12:00:00Z",
      voicePart: "Soprano",
    },
    {
      attendance: "Pending",
      displayName: "Bob Singer",
      profileId: "profile-2",
      rsvp: "Yes",
      updatedAt: "2026-03-01T12:00:00Z",
      voicePart: "Tenor",
    },
    {
      attendance: "Pending",
      displayName: "Charlie Singer",
      profileId: "profile-3",
      rsvp: "No",
      updatedAt: "2026-03-01T12:00:00Z",
      voicePart: "Bass",
    },
    {
      attendance: "Pending",
      displayName: "Dana Singer",
      profileId: "profile-4",
      rsvp: "Pending",
      updatedAt: null,
      voicePart: "Alto",
    },
  ];

  it("renders live RSVP summary metrics and 'View full RSVP details →' link for saved Performance", async () => {
    vi.mocked(listOrganizationEventAttendance).mockResolvedValue(sampleAttendance);

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="perf-saved-1"
        error={null}
        event={savedPerformance}
        eventStart="2026-10-15T19:30"
        graphicFile={null}
        navigate={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/RSVPs & reminders/);

    expect(await screen.findByText("Attending: 2")).toBeInTheDocument();
    expect(screen.getByText("Declined: 1")).toBeInTheDocument();
    expect(screen.getByText("No response: 1")).toBeInTheDocument();
    expect(screen.getByText("Total: 4")).toBeInTheDocument();

    expect(
      await screen.findByText(/1 awaiting response can receive RSVP email/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request RSVPs" })).toHaveAttribute(
      "href",
      expect.stringContaining("rsvpEventId=perf-saved-1"),
    );
    const link = screen.getByRole("link", { name: "View full RSVP details →" });
    expect(link).toHaveAttribute("href", "/admin/rsvp?eventId=perf-saved-1");
  });

  it("keeps manual RSVP email closed when an event has no pending responses", async () => {
    vi.mocked(listOrganizationEventAttendance).mockResolvedValue(
      sampleAttendance.map((row) => ({ ...row, rsvp: "Yes" as const })),
    );

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="perf-saved-1"
        error={null}
        event={savedPerformance}
        eventStart="2026-10-15T19:30"
        graphicFile={null}
        navigate={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/RSVPs & reminders/);
    expect(await screen.findByText("No response: 0")).toBeInTheDocument();
    const details = screen.getByText("Manual RSVP email").closest("details");
    expect(details).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("Manual RSVP email"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByRole("link", { name: "Request RSVPs" })).toBeInTheDocument();
  });

  it("separates On Break and Inactive members from active RSVP totals", async () => {
    vi.mocked(listOrganizationEventAttendance).mockResolvedValue(sampleAttendance);

    const base = sampleActiveProfiles[0];
    if (!base) throw new Error("Missing profile fixture");
    vi.mocked(listOrganizationProfiles).mockResolvedValue([
      { ...base, id: "profile-1", globalStatus: "Idle" },
      { ...base, id: "profile-2", globalStatus: "Inactive" },
      { ...base, id: "profile-3" },
      { ...base, id: "profile-4" },
    ]);
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="perf-saved-1"
        error={null}
        event={savedPerformance}
        eventStart="2026-10-15T19:30"
        graphicFile={null}
        navigate={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/RSVPs & reminders/);

    expect(await screen.findByText("Attending: 0")).toBeInTheDocument();
    expect(screen.getByText("Declined: 1")).toBeInTheDocument();
    expect(screen.getByText("No response: 1")).toBeInTheDocument();
    expect(screen.getByText("Total: 2")).toBeInTheDocument();

    expect(
      await screen.findByText(/1 awaiting response can receive RSVP email/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request RSVPs" })).toHaveAttribute(
      "href",
      expect.stringContaining("rsvpEventId=perf-saved-1"),
    );
    expect(
      screen.getByText(/Excluded from response totals: On Break: 1; Inactive: 1/),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "View full RSVP details →" });
    expect(link).toHaveAttribute("href", "/admin/rsvp?eventId=perf-saved-1");
  });

  it("navigates immediately to RSVP details when pristine", async () => {
    vi.mocked(listOrganizationEventAttendance).mockResolvedValue(sampleAttendance);
    const navigate = vi.fn();

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="perf-saved-1"
        error={null}
        event={savedPerformance}
        eventStart="2026-10-15T19:30"
        graphicFile={null}
        navigate={navigate}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/RSVPs & reminders/);

    const link = await screen.findByRole("link", { name: "View full RSVP details →" });
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith("/admin/rsvp?eventId=perf-saved-1");
  });

  it.each(["View full RSVP details →", "Request RSVPs"])(
    "guards dirty navigation through %s",
    async (actionName) => {
      vi.mocked(listOrganizationEventAttendance).mockResolvedValue(sampleAttendance);
      const navigate = vi.fn();

      const { rerender } = render(
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId="perf-saved-1"
          error={null}
          event={savedPerformance}
          eventStart="2026-10-15T19:30"
          graphicFile={null}
          navigate={navigate}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={vi.fn()}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />,
      );

      // Make dirty by changing title
      rerender(
        <EventEditorDialog
          busy={false}
          dialogOpen={true}
          editingId="perf-saved-1"
          error={null}
          event={{ ...savedPerformance, title: "Modified Title" }}
          eventStart="2026-10-15T19:30"
          graphicFile={null}
          navigate={navigate}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          setEvent={vi.fn()}
          setEventStart={vi.fn()}
          setGraphicFile={vi.fn()}
          state={stateWithVenues([venueHall])}
        />,
      );

      await switchToSection(/RSVPs & reminders/);

      const link = await screen.findByRole("link", { name: actionName });
      fireEvent.click(link);

      expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();

      // Cancel
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await Promise.resolve();
      expect(navigate).not.toHaveBeenCalled();

      // Click again and confirm
      fireEvent.click(screen.getByRole("link", { name: actionName }));
      expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      await Promise.resolve();

      expect(navigate).toHaveBeenCalledWith(
        actionName === "Request RSVPs"
          ? expect.stringContaining("/admin/communications?tab=compose&rsvpEventId=perf-saved-1")
          : "/admin/rsvp?eventId=perf-saved-1",
      );
    },
  );

  it("shows placeholder note on new events without fetching", async () => {
    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId={null}
        error={null}
        event={{ ...emptyEvent, type: "Performance" }}
        eventStart="2026-10-15T19:30"
        graphicFile={null}
        navigate={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/RSVPs & reminders/);

    expect(
      screen.getByText("Save this event to view RSVP responses and manage attendance."),
    ).toBeInTheDocument();
    expect(listOrganizationEventAttendance).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("link", { name: "View full RSVP details →" }),
    ).not.toBeInTheDocument();
  });

  it("renders RSVP summary and staffing goal on saved Other event with RSVP enabled", async () => {
    vi.mocked(listOrganizationEventAttendance).mockResolvedValue(sampleAttendance);

    const otherEventWithRsvp: OrganizationEventRequest = {
      ...emptyEvent,
      type: "Other",
      otherEventAudience: { type: "everyone" },
      otherEventRsvpMode: "optional",
      otherEventStaffingGoal: 5,
      title: "Community Outreach",
      venueId: "venue-1",
    };

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="other-saved-1"
        error={null}
        event={otherEventWithRsvp}
        eventStart="2026-10-15T19:30"
        graphicFile={null}
        navigate={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/RSVPs & reminders/);

    expect(await screen.findByText("Attending: 2")).toBeInTheDocument();
    expect(screen.getByText(/Staffing goal:/)).toHaveTextContent(
      "Staffing goal: 2 of 5 volunteers committed.",
    );
    expect(screen.getByRole("link", { name: "View full RSVP details →" })).toHaveAttribute(
      "href",
      "/admin/rsvp?eventId=other-saved-1",
    );
  });

  it("hides RSVP summary on Other event when RSVP mode is off", async () => {
    const otherEventRsvpOff: OrganizationEventRequest = {
      ...emptyEvent,
      type: "Other",
      otherEventRsvpMode: "off",
      title: "Board Meeting",
      venueId: "venue-1",
    };

    render(
      <EventEditorDialog
        busy={false}
        dialogOpen={true}
        editingId="other-saved-1"
        error={null}
        event={otherEventRsvpOff}
        eventStart="2026-10-15T19:30"
        graphicFile={null}
        navigate={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        setEvent={vi.fn()}
        setEventStart={vi.fn()}
        setGraphicFile={vi.fn()}
        state={stateWithVenues([venueHall])}
      />,
    );

    await switchToSection(/RSVPs & reminders/);

    expect(screen.queryByText("RSVP responses")).not.toBeInTheDocument();
    expect(listOrganizationEventAttendance).not.toHaveBeenCalled();
  });
});
