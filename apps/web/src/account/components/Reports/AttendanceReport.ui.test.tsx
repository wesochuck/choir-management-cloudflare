import { organizationEventSchema, type OrganizationEvent } from "@choir/contracts";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";

import * as api from "../../../auth/api";
import { AttendanceReport } from "./AttendanceReport";
import * as reportHelpers from "./reportHelpers";

const basePerformance: OrganizationEvent = organizationEventSchema.parse({
  createdAt: "2026-09-01T12:00:00Z",
  durationMinutes: 120,
  id: "11111111-1111-4111-8111-111111111111",
  isCanceled: false,
  location: "Concert Hall",
  parentPerformanceId: null,
  rsvpDeadlineDate: "2026-10-01",
  startsAt: "2026-10-15T19:00:00Z",
  title: "Fall Concert",
  type: "Performance",
  updatedAt: "2026-09-01T12:00:00Z",
});

const basePerformance2: OrganizationEvent = organizationEventSchema.parse({
  ...basePerformance,
  id: "22222222-2222-4222-8222-222222222222",
  title: "Winter Concert",
});

const linkedRehearsal1: OrganizationEvent = organizationEventSchema.parse({
  ...basePerformance,
  id: "33333333-3333-4333-8333-333333333333",
  parentPerformanceId: basePerformance.id,
  rsvpDeadlineDate: null,
  startsAt: "2026-10-01T19:00:00Z",
  title: "Rehearsal 1",
  type: "Rehearsal",
});

const linkedRehearsal2: OrganizationEvent = organizationEventSchema.parse({
  ...basePerformance,
  id: "44444444-4444-4444-8444-444444444444",
  parentPerformanceId: basePerformance.id,
  rsvpDeadlineDate: null,
  startsAt: "2026-10-08T19:00:00Z",
  title: "Rehearsal 2",
  type: "Rehearsal",
});

const canceledRehearsal: OrganizationEvent = organizationEventSchema.parse({
  ...basePerformance,
  id: "55555555-5555-4555-8555-555555555555",
  isCanceled: true,
  parentPerformanceId: basePerformance.id,
  rsvpDeadlineDate: null,
  startsAt: "2026-10-05T19:00:00Z",
  title: "Canceled Rehearsal",
  type: "Rehearsal",
});

const perf2Rehearsal: OrganizationEvent = organizationEventSchema.parse({
  ...basePerformance,
  id: "66666666-6666-4666-8666-666666666666",
  parentPerformanceId: basePerformance2.id,
  rsvpDeadlineDate: null,
  startsAt: "2026-11-01T19:00:00Z",
  title: "Winter Rehearsal",
  type: "Rehearsal",
});

const sampleRows = [
  {
    absences: 2,
    name: "Bob Singer",
    present: 0,
    profileId: "aaaa1111-1111-4111-8111-111111111111",
    total: 2,
    voicePart: "Tenor",
  },
  {
    absences: 0,
    name: "Alice Singer",
    present: 2,
    profileId: "bbbb2222-2222-4222-8222-222222222222",
    total: 2,
    voicePart: "Soprano",
  },
];

describe("AttendanceReport UI", () => {
  it("renders empty state without making a network request when no performance is selected", () => {
    const reportSpy = vi.spyOn(api, "getOrganizationEventAttendanceReport");
    render(
      <AttendanceReport
        events={[basePerformance, linkedRehearsal1]}
        onChange={() => undefined}
        performerLabel="Singer"
        selectedId=""
      />,
    );

    expect(screen.getByText("Choose a performance to view attendance.")).toBeInTheDocument();
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("renders empty state without making a network request when performance has no rehearsals", () => {
    const reportSpy = vi.spyOn(api, "getOrganizationEventAttendanceReport");
    render(
      <AttendanceReport
        events={[basePerformance, canceledRehearsal]} // canceled rehearsal is ignored
        onChange={() => undefined}
        performerLabel="Singer"
        selectedId={basePerformance.id}
      />,
    );

    expect(screen.getByText("No rehearsals are linked to this performance.")).toBeInTheDocument();
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it("fetches attendance summary with exactly one server request and displays KPIs and table", async () => {
    const reportSpy = vi.spyOn(api, "getOrganizationEventAttendanceReport").mockResolvedValueOnce({
      eventId: basePerformance.id,
      requestId: "req-1",
      rows: sampleRows,
      totalRehearsals: 2,
    });

    render(
      <AttendanceReport
        events={[basePerformance, linkedRehearsal1, linkedRehearsal2, canceledRehearsal]}
        onChange={() => undefined}
        performerLabel="Singer"
        selectedId={basePerformance.id}
      />,
    );

    // Exactly one request was made for the performance, not per-rehearsal fanout
    expect(reportSpy).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledWith(basePerformance.id, expect.any(AbortSignal));

    await waitFor(() => {
      expect(screen.getAllByText("Bob Singer").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Alice Singer").length).toBeGreaterThan(0);
    });

    // KPI verification
    expect(screen.getByText("Attendance summary")).toBeInTheDocument();
    expect(screen.getByText("Profiles tracked")).toBeInTheDocument();
  });

  it("prevents late previous selection from replacing current result", async () => {
    let resolveFirst!: (value: {
      eventId: string;
      requestId: string;
      rows: typeof sampleRows;
      totalRehearsals: number;
    }) => void;
    const firstPromise = new Promise<{
      eventId: string;
      requestId: string;
      rows: typeof sampleRows;
      totalRehearsals: number;
    }>((resolve) => {
      resolveFirst = resolve;
    });

    const reportSpy = vi.spyOn(api, "getOrganizationEventAttendanceReport");
    reportSpy.mockImplementation((id: string) => {
      if (id === basePerformance.id) {
        return firstPromise;
      }
      return Promise.resolve({
        eventId: basePerformance2.id,
        requestId: "req-2",
        rows: [
          {
            absences: 1,
            name: "Winter Performer",
            present: 0,
            profileId: "cccc3333-3333-4333-8333-333333333333",
            total: 1,
            voicePart: "Bass",
          },
        ],
        totalRehearsals: 1,
      });
    });

    const { rerender } = render(
      <AttendanceReport
        events={[basePerformance, basePerformance2, linkedRehearsal1, perf2Rehearsal]}
        onChange={() => undefined}
        performerLabel="Singer"
        selectedId={basePerformance.id}
      />,
    );

    expect(screen.getByText("Loading report…")).toBeInTheDocument();

    // User switches to Winter Concert (basePerformance2) before first request resolves
    rerender(
      <AttendanceReport
        events={[basePerformance, basePerformance2, linkedRehearsal1, perf2Rehearsal]}
        onChange={() => undefined}
        performerLabel="Singer"
        selectedId={basePerformance2.id}
      />,
    );

    // Second request resolves
    await waitFor(() => {
      expect(screen.getAllByText("Winter Performer").length).toBeGreaterThan(0);
    });

    // Now first request resolves late
    act(() => {
      resolveFirst({
        eventId: basePerformance.id,
        requestId: "req-1",
        rows: sampleRows,
        totalRehearsals: 2,
      });
    });

    // Winter Performer is still displayed; Bob Singer from late response was discarded
    expect(screen.getAllByText("Winter Performer").length).toBeGreaterThan(0);
    expect(screen.queryByText("Bob Singer")).not.toBeInTheDocument();
  });

  it("displays error notice on network failure", async () => {
    vi.spyOn(api, "getOrganizationEventAttendanceReport").mockRejectedValueOnce(
      new Error("Network failure"),
    );

    render(
      <AttendanceReport
        events={[basePerformance, linkedRehearsal1]}
        onChange={() => undefined}
        performerLabel="Singer"
        selectedId={basePerformance.id}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("This report could not be loaded. Try again.")).toBeInTheDocument();
    });
  });

  it("exports CSV with attendance summary rows", async () => {
    const downloadCsvSpy = vi
      .spyOn(reportHelpers, "downloadCsv")
      .mockImplementation(() => undefined);
    vi.spyOn(api, "getOrganizationEventAttendanceReport").mockResolvedValueOnce({
      eventId: basePerformance.id,
      requestId: "req-1",
      rows: sampleRows,
      totalRehearsals: 2,
    });

    render(
      <AttendanceReport
        events={[basePerformance, linkedRehearsal1]}
        onChange={() => undefined}
        performerLabel="Singer"
        selectedId={basePerformance.id}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Export CSV")).not.toBeDisabled();
    });

    fireEvent.click(screen.getByText("Export CSV"));

    expect(downloadCsvSpy).toHaveBeenCalledWith(
      "attendance-report.csv",
      expect.arrayContaining([
        ["Name", "Singer", "Absences", "Present", "Total rehearsals", "Attendance rate"],
        ["Bob Singer", "Tenor", 2, 0, 2, "0.0%"],
        ["Alice Singer", "Soprano", 0, 2, 2, "100.0%"],
      ]),
    );
  });
});
