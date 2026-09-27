import {
  organizationEventSchema,
  type OrganizationCalendarSettings,
  type OrganizationEvent,
  type OrganizationProfile,
  type OrganizationRosterConfiguration,
  type OrganizationSeatingChart,
  type SeatingConfiguration,
} from "@choir/contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as authApiModule from "../../../auth/api";
import * as api from "../../../auth/api";
import { SeatingManager } from "./controller";

vi.mock("../../../auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof authApiModule>();
  return {
    ...actual,
    createOrganizationSeatingChart: vi.fn(),
    getOrganizationCalendarSettings: vi.fn(),
    getOrganizationRosterConfiguration: vi.fn(),
    getOrganizationSeatingConfiguration: vi.fn(),
    listOrganizationEventAttendance: vi.fn(),
    listOrganizationEvents: vi.fn(),
    listOrganizationProfiles: vi.fn(),
    listOrganizationSeatingCharts: vi.fn(),
  };
});

function performance(
  id: string,
  title: string,
  startsAt: string,
  type = "Performance",
): OrganizationEvent {
  return organizationEventSchema.parse({
    createdAt: "2025-01-01T00:00:00.000Z",
    id,
    setList: [],
    setListApproved: false,
    setListDefaultTransitionSeconds: 0,
    startsAt,
    title,
    type,
    updatedAt: "2025-01-01T00:00:00.000Z",
  });
}

function chart(id: string, eventId: string, name: string): OrganizationSeatingChart {
  return {
    assignments: {},
    createdAt: "2025-01-01T00:00:00.000Z",
    eventId,
    formationId: "f1",
    id,
    name,
    rowCounts: [10],
    sectionSuggestions: {},
    sortOrder: 0,
    updatedAt: "2025-01-01T00:00:00.000Z",
    venueId: null,
  };
}

const mockRoster: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 3,
  onBreakTimeoutDays: 30,
  onBreakTimeoutEnabled: false,
  performerLabel: "Performer",
  rsvpExpiryEnabled: false,
  rsvpFollowUpEnabled: false,
  rsvpFollowUpLeadHours: 24,
  sections: [{ code: "Soprano", color: "#112233", name: "Soprano", trackOnly: false }],
  statusAutomationEnabled: false,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: false,
  voiceParts: [
    { fullName: "Soprano 1", label: "S1", sectionCode: "Soprano" },
    { fullName: "Alto 1", label: "A1", sectionCode: "Soprano" },
  ],
};

const mockSeating: SeatingConfiguration = {
  defaultFormationId: "f1",
  formations: [
    {
      id: "f1",
      isVoicePartLayout: false,
      name: "Standard",
      sectionOrder: ["Soprano"],
      strategy: "horizontal_row",
    },
  ],
};

const profiles: readonly OrganizationProfile[] = [];

async function flushLoad(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 15; i++) {
      await Promise.resolve();
    }
  });
}

describe("SeatingManager default Performance selection", () => {
  const defaultCalendar: OrganizationCalendarSettings = {
    timezone: "America/New_York",
  };

  const todayPassedPerformance = performance(
    "11111111-1111-4111-8111-111111111111",
    "Today Concert Earlier",
    "2025-01-15T12:00:00.000Z",
  );
  const todayLaterPerformance = performance(
    "22222222-2222-4222-8222-222222222222",
    "Today Concert Later",
    "2025-01-15T22:00:00.000Z",
  );
  const tomorrowPerformance = performance(
    "33333333-3333-4333-8333-333333333333",
    "Tomorrow Concert",
    "2025-01-16T19:00:00.000Z",
  );
  const pastPerformance = performance(
    "44444444-4444-4444-8444-444444444444",
    "Past Concert",
    "2025-01-10T19:00:00.000Z",
  );
  const distantFuturePerformance = performance(
    "55555555-5555-4555-8555-555555555555",
    "Distant Concert",
    "2025-04-01T19:00:00.000Z",
  );
  const rehearsalCloser = performance(
    "66666666-6666-4666-8666-666666666666",
    "Closer Rehearsal",
    "2025-01-15T10:00:00.000Z",
    "Rehearsal",
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2025-01-15T17:00:00.000Z"));
    vi.mocked(api.getOrganizationCalendarSettings).mockResolvedValue(defaultCalendar);
    vi.mocked(api.getOrganizationRosterConfiguration).mockResolvedValue(mockRoster);
    vi.mocked(api.getOrganizationSeatingConfiguration).mockResolvedValue(mockSeating);
    vi.mocked(api.listOrganizationProfiles).mockResolvedValue(profiles);
    vi.mocked(api.listOrganizationEvents).mockResolvedValue([
      distantFuturePerformance,
      pastPerformance,
      tomorrowPerformance,
      rehearsalCloser,
      todayLaterPerformance,
      todayPassedPerformance,
    ]);
    vi.mocked(api.listOrganizationSeatingCharts).mockImplementation((eventId) =>
      Promise.resolve([chart(`chart-${eventId}`, eventId, `Chart for ${eventId}`)]),
    );
    vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.replaceState({}, "", "/");
  });

  it("selects the nearest eligible Performance from unsorted events, ignoring rehearsals and past events", async () => {
    render(<SeatingManager enabled />);
    await flushLoad();

    // Today earlier than now is still today in America/New_York (2025-01-15T12:00:00Z)
    const select = screen.getByLabelText("Seating Performance");
    expect(select).toHaveValue(todayPassedPerformance.id);
    expect(window.location.search).toContain(`eventId=${todayPassedPerformance.id}`);
  });

  it("selects the closest upcoming Performance when no concerts occurred today", async () => {
    vi.mocked(api.listOrganizationEvents).mockResolvedValue([
      pastPerformance,
      distantFuturePerformance,
      tomorrowPerformance,
    ]);

    render(<SeatingManager enabled />);
    await flushLoad();

    const select = screen.getByLabelText("Seating Performance");
    expect(select).toHaveValue(tomorrowPerformance.id);
  });

  it("respects Organization timezone across date boundaries", async () => {
    // At 2025-11-02T04:15:00Z:
    // In America/New_York (EDT, UTC-4), this is 2025-11-02 00:15:00.
    // eventA at 2025-11-02T04:30:00Z is 2025-11-02 00:30:00 (today in NY).
    // eventB at 2025-11-03T05:30:00Z is 2025-11-03 00:30:00 (tomorrow in NY).
    const eventA = performance(
      "77777777-7777-4777-8777-777777777777",
      "Local Today",
      "2025-11-02T04:30:00.000Z",
    );
    const eventB = performance(
      "88888888-8888-4888-8888-888888888888",
      "Local Tomorrow",
      "2025-11-03T05:30:00.000Z",
    );

    vi.setSystemTime(new Date("2025-11-02T04:15:00.000Z"));
    vi.mocked(api.listOrganizationEvents).mockResolvedValue([eventB, eventA]);

    render(<SeatingManager enabled />);
    await flushLoad();

    const select = screen.getByLabelText("Seating Performance");
    expect(select).toHaveValue(eventA.id);
  });

  it("falls back to the most recent past Performance when all concerts are past", async () => {
    const olderPast = performance(
      "99999999-9999-4999-8999-999999999999",
      "Older Past",
      "2024-12-01T12:00:00.000Z",
    );
    vi.mocked(api.listOrganizationEvents).mockResolvedValue([olderPast, pastPerformance]);

    render(<SeatingManager enabled />);
    await flushLoad();

    const select = screen.getByLabelText("Seating Performance");
    expect(select).toHaveValue(pastPerformance.id);
  });

  it("breaks equal-start-time ties deterministically by ID", async () => {
    const perfZ = performance(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "Concert Z",
      "2025-01-16T19:00:00.000Z",
    );
    const perfA = performance(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "Concert A",
      "2025-01-16T19:00:00.000Z",
    );
    vi.mocked(api.listOrganizationEvents).mockResolvedValue([perfZ, perfA]);

    render(<SeatingManager enabled />);
    await flushLoad();

    const select = screen.getByLabelText("Seating Performance");
    expect(select).toHaveValue(perfA.id);
  });

  it("shows empty state when no Performances exist and makes no chart requests", async () => {
    vi.mocked(api.listOrganizationEvents).mockResolvedValue([rehearsalCloser]);

    render(<SeatingManager enabled />);
    await flushLoad();

    expect(screen.getByRole("heading", { name: "Create an event first" })).toBeInTheDocument();
    expect(api.listOrganizationSeatingCharts).not.toHaveBeenCalled();
    expect(api.listOrganizationEventAttendance).not.toHaveBeenCalled();
  });

  it("honors valid explicit event deep links, and falls back to default if eventId is non-Performance or unknown", async () => {
    window.history.replaceState({}, "", `/?eventId=${distantFuturePerformance.id}`);
    const { unmount } = render(<SeatingManager enabled />);
    await flushLoad();

    expect(screen.getByLabelText("Seating Performance")).toHaveValue(distantFuturePerformance.id);
    unmount();

    // Now test invalid / non-performance eventId:
    window.history.replaceState({}, "", `/?eventId=invalid-event-id`);
    render(<SeatingManager enabled />);
    await flushLoad();

    expect(screen.getByLabelText("Seating Performance")).toHaveValue(todayPassedPerformance.id);
  });

  it("honors valid chartId within chosen event and resets stale/foreign chartId", async () => {
    const validChart = chart("chart-valid", todayPassedPerformance.id, "Valid Chart");
    vi.mocked(api.listOrganizationSeatingCharts).mockResolvedValue([validChart]);

    window.history.replaceState(
      {},
      "",
      `/?eventId=${todayPassedPerformance.id}&chartId=chart-valid&extra=keep`,
    );
    const { unmount } = render(<SeatingManager enabled />);
    await flushLoad();

    expect(screen.getAllByLabelText("Select seating chart")[0]).toHaveValue("chart-valid");
    expect(window.location.search).toContain("extra=keep");
    unmount();

    // Stale/foreign chartId that does not exist in this event
    window.history.replaceState(
      {},
      "",
      `/?eventId=${todayPassedPerformance.id}&chartId=stale-foreign-id&extra=keep`,
    );
    render(<SeatingManager enabled />);
    await flushLoad();

    expect(screen.getAllByLabelText("Select seating chart")[0]).toHaveValue("chart-valid");
    expect(window.location.search).toContain("chartId=chart-valid");
    expect(window.location.search).toContain("extra=keep");
  });

  it("survives resource re-fetches without replacing manual user selection", async () => {
    const { rerender } = render(<SeatingManager enabled />);
    await flushLoad();

    const select = screen.getByLabelText("Seating Performance");
    expect(select).toHaveValue(todayPassedPerformance.id);

    // User manually selects distant future performance
    fireEvent.change(select, { target: { value: distantFuturePerformance.id } });
    await flushLoad();
    expect(select).toHaveValue(distantFuturePerformance.id);

    // Re-render / refresh resources
    rerender(<SeatingManager enabled />);
    await flushLoad();

    expect(screen.getByLabelText("Seating Performance")).toHaveValue(distantFuturePerformance.id);
  });

  it("renders an error alert when calendar settings fail and does not load chart", async () => {
    vi.mocked(api.getOrganizationCalendarSettings).mockRejectedValue(
      new Error("Calendar unavailable"),
    );

    render(<SeatingManager enabled />);
    await flushLoad();

    expect(screen.getByRole("alert")).toHaveTextContent("Calendar unavailable");
    expect(api.listOrganizationSeatingCharts).not.toHaveBeenCalled();
  });

  it("selects a nearest concert with no charts without auto-creating or saving", async () => {
    vi.mocked(api.listOrganizationSeatingCharts).mockResolvedValue([]);

    render(<SeatingManager enabled />);
    await flushLoad();

    const select = screen.getByLabelText("Seating Performance");
    expect(select).toHaveValue(todayPassedPerformance.id);
    expect(screen.getByRole("heading", { name: "Start a seating chart" })).toBeInTheDocument();
    expect(api.createOrganizationSeatingChart).not.toHaveBeenCalled();
  });
});
