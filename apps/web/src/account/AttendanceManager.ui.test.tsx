import {
  type OrganizationAttendanceRow,
  type OrganizationEvent,
  organizationEventSchema,
  type OrganizationRosterConfiguration,
  type OrganizationVenue,
} from "@choir/contracts";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, act, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { AttendanceManager } from "./AttendanceManager";
import {
  useAttendanceFiltering,
  useAttendanceMutations,
  useAttendanceQueries,
} from "./components/AttendanceManager/hooks";
import type { ReactNode } from "react";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    getOrganizationCalendarSettings: vi.fn(),
    getOrganizationRosterConfiguration: vi.fn(),
    listOrganizationEventAttendance: vi.fn(),
    listOrganizationEvents: vi.fn(),
    listOrganizationProfiles: vi.fn(),
    listOrganizationVenues: vi.fn(),
    updateOrganizationEventAttendance: vi.fn(),
  };
});

const mockRosterConfig: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Singer",
  rehearsalAttendanceReportsEnabled: true,
  rsvpExpiryEnabled: true,
  rsvpFollowUpEnabled: true,
  rsvpFollowUpLeadHours: 48,
  sections: [
    { code: "A", color: "#10b981", name: "Altos", trackOnly: false },
    { code: "B", color: "#ef4444", name: "Basses", trackOnly: false },
  ],
  statusAutomationEnabled: true,
  statusAutomationMissThreshold: 3,
  statusAutomationRecoveryEnabled: true,
  voiceParts: [
    { fullName: "Alto 1", label: "A1", sectionCode: "A" },
    { fullName: "Alto 2", label: "A2", sectionCode: "A" },
    { fullName: "Bass 1", label: "B1", sectionCode: "B" },
    { fullName: "Bass 2", label: "B2", sectionCode: "B" },
  ],
};

const mockEvent: OrganizationEvent = organizationEventSchema.parse({
  callTime: "18:30",
  createdAt: "2026-09-01T00:00:00Z",
  description: "Fall Concert rehearsal",
  id: "22222222-2222-4222-8222-222222222221",
  startsAt: "2026-10-15T19:00:00Z",
  status: "scheduled",
  title: "Fall Concert Rehearsal",
  type: "Rehearsal",
  updatedAt: "2026-09-01T00:00:00Z",
  venueId: "11111111-1111-4111-8111-111111111111",
});

const mockVenue: OrganizationVenue = {
  address: "123 Main St",
  createdAt: "2026-09-01T00:00:00Z",
  id: "11111111-1111-4111-8111-111111111111",
  name: "Community Center",
  updatedAt: "2026-09-01T00:00:00Z",
};

const mockRows: OrganizationAttendanceRow[] = [
  {
    attendance: "Pending",
    displayName: "Alice Walker",
    profileId: "p-1",
    rsvp: "Yes",
    updatedAt: null,
    voicePart: "A1",
  },
  {
    attendance: "Pending",
    displayName: "John van Horn",
    profileId: "p-2",
    rsvp: "Yes",
    updatedAt: null,
    voicePart: "A2",
  },
  {
    attendance: "Pending",
    displayName: "Bob Iverson",
    profileId: "p-3",
    rsvp: "Yes",
    updatedAt: null,
    voicePart: "A1",
  },
  {
    attendance: "Pending",
    displayName: "Charlie Bass",
    profileId: "p-4",
    rsvp: "Yes",
    updatedAt: null,
    voicePart: "B1",
  },
];

describe("AttendanceManager section grouping and sorting UI", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    vi.mocked(api.getOrganizationCalendarSettings).mockResolvedValue({
      timezone: "America/New_York",
    });
    vi.mocked(api.listOrganizationEvents).mockResolvedValue([mockEvent]);
    vi.mocked(api.listOrganizationProfiles).mockResolvedValue([]);
    vi.mocked(api.listOrganizationVenues).mockResolvedValue([mockVenue]);
    vi.mocked(api.getOrganizationRosterConfiguration).mockResolvedValue(mockRosterConfig);
    vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue(mockRows);
  });

  function renderComponent(initialTab?: "attendance" | "automation") {
    return render(
      <QueryClientProvider client={queryClient}>
        <AttendanceManager enabled={true} {...(initialTab === undefined ? {} : { initialTab })} />
      </QueryClientProvider>,
    );
  }

  it("renders section headings rather than voice-part headings and sorts singers by surname", async () => {
    renderComponent();

    // Verify section heading "Altos" appears and there is NO separate "A1" or "A2" heading
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 3, name: "Altos" })).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { level: 3, name: "Basses" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Live updates every 5 seconds");
    expect(screen.queryByRole("heading", { level: 3, name: "A1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "A2" })).not.toBeInTheDocument();

    // In the Altos group, singers must appear in surname order: Bob Iverson, John van Horn, Alice Walker
    const altosGroup = screen
      .getByRole("heading", { level: 3, name: "Altos" })
      .closest(".attendance-group");
    expect(altosGroup).not.toBeNull();
    if (!altosGroup) return;

    const singerNames = Array.from(altosGroup.querySelectorAll("strong")).map(
      (el) => el.textContent,
    );
    expect(singerNames).toEqual(["Bob Iverson", "John van Horn", "Alice Walker"]);

    // Individual voice part labels remain visible in secondary text
    expect(altosGroup).toHaveTextContent("A1 · Tap to check in");
    expect(altosGroup).toHaveTextContent("A2 · Tap to check in");
  });

  it("filters singers by search query across names and voice parts", async () => {
    const user = userEvent.setup();
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Alice Walker")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search name or part");
    await user.type(searchInput, "Iverson");

    expect(screen.getByText("Bob Iverson")).toBeInTheDocument();
    expect(screen.queryByText("Alice Walker")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie Bass")).not.toBeInTheDocument();
  });

  it("toggles attendance status when a singer row is clicked", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValue(mockRows);
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Bob Iverson")).toBeInTheDocument();
    });

    const bobButton = screen.getByRole("button", {
      name: /Bob Iverson: Tap to check in/,
    });
    await user.click(bobButton);

    expect(api.updateOrganizationEventAttendance).toHaveBeenCalledWith(mockEvent.id, [
      expect.objectContaining({
        attendance: "Present",
        profileId: "p-3",
      }),
    ]);
  });

  it("safely isolates optimistic rollback when concurrent row saves fail and succeed", async () => {
    const user = userEvent.setup();
    let rejectBob: ((err: Error) => void) | undefined;
    let resolveCharlie: ((rows: OrganizationAttendanceRow[]) => void) | undefined;

    vi.mocked(api.updateOrganizationEventAttendance).mockImplementation(
      async (_eventId, updates) => {
        const update = updates[0];
        if (update?.profileId === "p-3") {
          return new Promise<OrganizationAttendanceRow[]>((_resolve, reject) => {
            rejectBob = reject;
          });
        }
        if (update?.profileId === "p-4") {
          return new Promise<OrganizationAttendanceRow[]>((resolve) => {
            resolveCharlie = resolve;
          });
        }
        return mockRows;
      },
    );

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Bob Iverson")).toBeInTheDocument();
      expect(screen.getByText("Charlie Bass")).toBeInTheDocument();
    });

    const allFilterButton = screen.getByRole("button", { name: "All 4" });
    await user.click(allFilterButton);

    const bobButton = screen.getByRole("button", {
      name: /Bob Iverson: Tap to check in/,
    });
    const charlieButton = screen.getByRole("button", {
      name: /Charlie Bass: Tap to check in/,
    });

    // Click Bob then Charlie
    await user.click(bobButton);
    await user.click(charlieButton);

    // Optimistically, both should show Present
    expect(screen.getByRole("button", { name: /Bob Iverson: Present/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Charlie Bass: Present/ })).toBeInTheDocument();

    const charlieRow = mockRows.find((r) => r.profileId === "p-4");
    if (!charlieRow) throw new Error("Expected p-4 mock row");

    vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue(
      mockRows.map((row) => (row.profileId === "p-4" ? { ...row, attendance: "Present" } : row)),
    );
    // Now Charlie succeeds
    resolveCharlie?.([
      {
        ...charlieRow,
        attendance: "Present",
      },
    ]);

    // Bob fails
    rejectBob?.(new Error("Network error"));

    // Verify Bob is rolled back to Pending, while Charlie remains Present
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Bob Iverson: Tap to check in/ }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Charlie Bass: Present/ })).toBeInTheDocument();
      expect(
        screen.getByText("That attendance update could not be saved. Try again."),
      ).toBeInTheDocument();
    });
  });

  it("safely rolls back bulk attendance updates on failure without affecting other rows", async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateOrganizationEventAttendance).mockRejectedValueOnce(
      new Error("Bulk update failed"),
    );

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText("Bob Iverson")).toBeInTheDocument();
    });

    const allFilterButton = screen.getByRole("button", { name: "All 4" });
    await user.click(allFilterButton);

    const bulkButton = screen.getByRole("button", { name: "Mark remaining present" });
    await user.click(bulkButton);

    // In dialog
    const dialogConfirm = screen.getAllByRole("button", { name: "Mark remaining present" });
    const lastConfirm = dialogConfirm[dialogConfirm.length - 1];
    if (!lastConfirm) throw new Error("Expected confirm button");
    await user.click(lastConfirm);

    await waitFor(() => {
      expect(
        screen.getByText("The remaining attendance could not be saved. Try again."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Bob Iverson: Tap to check in/ }),
      ).toBeInTheDocument();
    });
  });

  it("renders Event attendance tab as default and allows switching to Attendance automation", async () => {
    const user = userEvent.setup();
    renderComponent();

    expect(screen.getByRole("tab", { name: "Event attendance" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Attendance automation" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Attendance automation" }));
    expect(screen.getByRole("tab", { name: "Attendance automation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByRole("region", { name: "Attendance automation settings" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("checkbox", { name: "Send attendance reports for Rehearsals" }),
    ).toBeInTheDocument();
  });

  it("respects initialTab='automation' prop", async () => {
    renderComponent("automation");

    expect(screen.getByRole("tab", { name: "Attendance automation" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      await screen.findByRole("region", { name: "Attendance automation settings" }),
    ).toBeInTheDocument();
  });

  it("does not render explainer paragraph and provides single-line accessible event selector with full title", async () => {
    renderComponent();

    // 1. Explainer paragraph is absent
    expect(screen.queryByText(/Tap a name to cycle/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Changes save immediately/i)).not.toBeInTheDocument();

    // 2. Event selector has accessible attributes, full title, and truncation class
    const eventSelect = await screen.findByRole("combobox", { name: "Event" });
    expect(eventSelect).toHaveClass("attendance-manager__event-select");
    await waitFor(() => {
      expect(eventSelect).toHaveAttribute(
        "title",
        expect.stringMatching(/Fall Concert Rehearsal/i),
      );
    });

    // 3. Options retain full title and location text
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]).toHaveAttribute("title", expect.stringMatching(/Fall Concert Rehearsal/i));
    });
  });

  describe("AttendanceManager Undo bar", () => {
    it("renders empty undo slot reserved space initially without interactive controls", async () => {
      renderComponent();
      await screen.findByRole("heading", { level: 3, name: "Altos" });

      const slot = document.querySelector(".attendance-undo-slot");
      expect(slot).toBeInTheDocument();
      expect(slot?.querySelector("button")).toBeNull();
      expect(screen.queryByRole("button", { name: /^Undo/i })).not.toBeInTheDocument();
    });

    it("shows undo bar after successful save and restores prior status on undo tap", async () => {
      const user = userEvent.setup();
      renderComponent();
      await screen.findByRole("heading", { level: 3, name: "Altos" });

      const aliceButton = screen.getByRole("button", {
        name: "Alice Walker: Tap to check in. Tap to change.",
      });

      const savedRows: OrganizationAttendanceRow[] = mockRows.map((r) =>
        r.profileId === "p-1"
          ? { ...r, attendance: "Present" as const, updatedAt: "2026-10-28T18:00:00.000Z" }
          : r,
      );
      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(savedRows);

      await user.click(aliceButton);

      await waitFor(() => {
        expect(screen.getByText("Alice Walker marked present")).toBeInTheDocument();
      });

      const undoButton = screen.getByRole("button", {
        name: "Undo: Alice Walker marked present",
      });
      expect(undoButton).toBeInTheDocument();

      // Tap Undo to restore
      const restoredRows: OrganizationAttendanceRow[] = mockRows.map((r) =>
        r.profileId === "p-1"
          ? { ...r, attendance: "Pending" as const, updatedAt: "2026-10-28T18:01:00.000Z" }
          : r,
      );
      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(restoredRows);

      await user.click(undoButton);

      await waitFor(() => {
        expect(api.updateOrganizationEventAttendance).toHaveBeenLastCalledWith(mockEvent.id, [
          {
            attendance: "Pending",
            expectedUpdatedAt: "2026-10-28T18:00:00.000Z",
            profileId: "p-1",
          },
        ]);
      });

      await waitFor(() => {
        expect(screen.queryByText("Alice Walker marked present")).not.toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: /^Undo/i })).not.toBeInTheDocument();
    });

    it("undoes sequential changes in LIFO order (A -> B -> C undoes as C -> B -> A)", async () => {
      const user = userEvent.setup();
      renderComponent();
      await screen.findByRole("heading", { level: 3, name: "Altos" });

      // Alice (A)
      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(
        mockRows.map((r) =>
          r.profileId === "p-1"
            ? { ...r, attendance: "Present" as const, updatedAt: "2026-10-28T18:01:00Z" }
            : r,
        ),
      );
      await user.click(
        screen.getByRole("button", { name: "Alice Walker: Tap to check in. Tap to change." }),
      );
      await waitFor(() => {
        expect(screen.getByText("Alice Walker marked present")).toBeInTheDocument();
      });

      // Bob (B)
      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(
        mockRows.map((r) =>
          r.profileId === "p-3"
            ? { ...r, attendance: "Present" as const, updatedAt: "2026-10-28T18:02:00Z" }
            : r,
        ),
      );
      await user.click(
        screen.getByRole("button", { name: "Bob Iverson: Tap to check in. Tap to change." }),
      );
      await waitFor(() => {
        expect(screen.getByText("Bob Iverson marked present")).toBeInTheDocument();
      });

      // Charlie (C)
      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(
        mockRows.map((r) =>
          r.profileId === "p-4"
            ? { ...r, attendance: "Present" as const, updatedAt: "2026-10-28T18:03:00Z" }
            : r,
        ),
      );
      await user.click(
        screen.getByRole("button", { name: "Charlie Bass: Tap to check in. Tap to change." }),
      );
      await waitFor(() => {
        expect(screen.getByText("Charlie Bass marked present")).toBeInTheDocument();
      });

      // Undo C -> Charlie
      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(
        mockRows.map((r) =>
          r.profileId === "p-4"
            ? { ...r, attendance: "Pending" as const, updatedAt: "2026-10-28T18:04:00Z" }
            : r,
        ),
      );
      await user.click(screen.getByRole("button", { name: "Undo: Charlie Bass marked present" }));

      // Now offers B -> Bob
      await waitFor(() => {
        expect(screen.getByText("Bob Iverson marked present")).toBeInTheDocument();
      });

      // Undo B -> Bob
      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(
        mockRows.map((r) =>
          r.profileId === "p-3"
            ? { ...r, attendance: "Pending" as const, updatedAt: "2026-10-28T18:05:00Z" }
            : r,
        ),
      );
      await user.click(screen.getByRole("button", { name: "Undo: Bob Iverson marked present" }));

      // Now offers A -> Alice
      await waitFor(() => {
        expect(screen.getByText("Alice Walker marked present")).toBeInTheDocument();
      });

      // Undo A -> Alice
      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(
        mockRows.map((r) =>
          r.profileId === "p-1"
            ? { ...r, attendance: "Pending" as const, updatedAt: "2026-10-28T18:06:00Z" }
            : r,
        ),
      );
      await user.click(screen.getByRole("button", { name: "Undo: Alice Walker marked present" }));

      // History is exhausted
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /^Undo/i })).not.toBeInTheDocument();
      });
    });

    it("does not add failed saves to undo history", async () => {
      const user = userEvent.setup();
      renderComponent();
      await screen.findByRole("heading", { level: 3, name: "Altos" });

      vi.mocked(api.updateOrganizationEventAttendance).mockRejectedValueOnce(
        new Error("Network failed"),
      );
      await user.click(
        screen.getByRole("button", { name: "Alice Walker: Tap to check in. Tap to change." }),
      );

      await waitFor(() => {
        expect(
          screen.getByText("That attendance update could not be saved. Try again."),
        ).toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: /^Undo/i })).not.toBeInTheDocument();
    });

    it("keeps failed undo retryable with Retry button", async () => {
      const user = userEvent.setup();
      renderComponent();
      await screen.findByRole("heading", { level: 3, name: "Altos" });

      // Save succeeds
      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(
        mockRows.map((r) =>
          r.profileId === "p-1"
            ? { ...r, attendance: "Present" as const, updatedAt: "2026-10-28T18:00:00Z" }
            : r,
        ),
      );
      await user.click(
        screen.getByRole("button", { name: "Alice Walker: Tap to check in. Tap to change." }),
      );
      await waitFor(() => {
        expect(screen.getByText("Alice Walker marked present")).toBeInTheDocument();
      });

      // Undo fails
      vi.mocked(api.updateOrganizationEventAttendance).mockRejectedValueOnce(
        new Error("Server error"),
      );
      await user.click(screen.getByRole("button", { name: "Undo: Alice Walker marked present" }));

      await waitFor(() => {
        expect(screen.getByText("Could not restore Alice Walker")).toBeInTheDocument();
      });
      const retryButton = screen.getByRole("button", {
        name: "Retry undo: Alice Walker marked present",
      });
      expect(retryButton).toBeInTheDocument();
      expect(retryButton).toHaveTextContent("Retry");

      // Retry succeeds
      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(
        mockRows.map((r) =>
          r.profileId === "p-1"
            ? { ...r, attendance: "Pending" as const, updatedAt: "2026-10-28T18:01:00Z" }
            : r,
        ),
      );
      await user.click(retryButton);

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /^Undo/i })).not.toBeInTheDocument();
      });
    });

    it("handles authoritative conflict (HTTP 409) during undo and reconciles view", async () => {
      const user = userEvent.setup();
      renderComponent();
      await screen.findByRole("heading", { level: 3, name: "Altos" });

      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(
        mockRows.map((r) =>
          r.profileId === "p-1"
            ? { ...r, attendance: "Present" as const, updatedAt: "2026-10-28T18:00:00Z" }
            : r,
        ),
      );
      await user.click(
        screen.getByRole("button", { name: "Alice Walker: Tap to check in. Tap to change." }),
      );
      await waitFor(() => {
        expect(screen.getByText("Alice Walker marked present")).toBeInTheDocument();
      });

      // Undo fails with conflict
      vi.mocked(api.updateOrganizationEventAttendance).mockRejectedValueOnce(
        new api.AuthApiError(
          "This attendance record was updated elsewhere. Refresh attendance and try again.",
          409,
          "attendance_conflict",
        ),
      );
      await user.click(screen.getByRole("button", { name: "Undo: Alice Walker marked present" }));

      await waitFor(() => {
        expect(
          screen.getByText(
            "Could not restore Alice Walker. That attendance record was updated elsewhere.",
          ),
        ).toBeInTheDocument();
      });
      // Stale entry is removed from undo bar
      expect(screen.queryByRole("button", { name: /^Undo/i })).not.toBeInTheDocument();
    });

    it("walks back repeated edits to the same performer through actual prior states", async () => {
      const user = userEvent.setup();
      let currentRows = [...mockRows];
      vi.mocked(api.listOrganizationEventAttendance).mockImplementation(() =>
        Promise.resolve(currentRows),
      );
      vi.mocked(api.updateOrganizationEventAttendance).mockImplementation((_eventId, updates) => {
        const updateMap = new Map(updates.map((u) => [u.profileId, u.attendance]));
        currentRows = currentRows.map((r) => {
          const nextStatus = updateMap.get(r.profileId);
          if (!nextStatus) return r;
          return {
            ...r,
            attendance: nextStatus,
            updatedAt:
              nextStatus === "Present"
                ? "2026-10-28T18:00:00Z"
                : nextStatus === "Absent"
                  ? "2026-10-28T18:05:00Z"
                  : "2026-10-28T18:15:00Z",
          };
        });
        return Promise.resolve(currentRows);
      });

      renderComponent();
      await screen.findByRole("heading", { level: 3, name: "Altos" });

      // Switch to All filter so performer remains visible when status changes
      await user.click(screen.getByRole("button", { name: /^All/ }));

      // Tap 1: Pending -> Present
      await user.click(
        screen.getByRole("button", { name: "Alice Walker: Tap to check in. Tap to change." }),
      );
      await waitFor(() => {
        expect(screen.getByText("Alice Walker marked present")).toBeInTheDocument();
      });

      // Tap 2: Present -> Absent
      await user.click(
        screen.getByRole("button", { name: "Alice Walker: Present. Tap to change." }),
      );
      await waitFor(() => {
        expect(screen.getByText("Alice Walker marked absent")).toBeInTheDocument();
      });

      // First Undo: Absent -> Present (checks expectedUpdatedAt: 18:05:00Z)
      await user.click(screen.getByRole("button", { name: "Undo: Alice Walker marked absent" }));

      await waitFor(() => {
        expect(api.updateOrganizationEventAttendance).toHaveBeenLastCalledWith(mockEvent.id, [
          {
            attendance: "Present",
            expectedUpdatedAt: "2026-10-28T18:05:00Z",
            profileId: "p-1",
          },
        ]);
      });

      // Now offers first change: Alice Walker marked present
      await waitFor(() => {
        expect(screen.getByText("Alice Walker marked present")).toBeInTheDocument();
      });

      // Second Undo: Present -> Pending (checks expectedUpdatedAt updated to 18:00:00Z!)
      await user.click(screen.getByRole("button", { name: "Undo: Alice Walker marked present" }));

      await waitFor(() => {
        expect(api.updateOrganizationEventAttendance).toHaveBeenLastCalledWith(mockEvent.id, [
          {
            attendance: "Pending",
            expectedUpdatedAt: "2026-10-28T18:00:00Z",
            profileId: "p-1",
          },
        ]);
      });

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /^Undo/i })).not.toBeInTheDocument();
      });
    });

    it("clears undo history when switching events", async () => {
      const user = userEvent.setup();
      const mockEvent2: OrganizationEvent = {
        ...mockEvent,
        id: "33333333-3333-4333-8333-333333333332",
        title: "Spring Concert",
      };
      vi.mocked(api.listOrganizationEvents).mockResolvedValue([mockEvent, mockEvent2]);

      renderComponent();
      await screen.findByRole("heading", { level: 3, name: "Altos" });

      vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValueOnce(
        mockRows.map((r) =>
          r.profileId === "p-1"
            ? { ...r, attendance: "Present" as const, updatedAt: "2026-10-28T18:00:00Z" }
            : r,
        ),
      );
      await user.click(
        screen.getByRole("button", { name: "Alice Walker: Tap to check in. Tap to change." }),
      );
      await waitFor(() => {
        expect(screen.getByText("Alice Walker marked present")).toBeInTheDocument();
      });

      // Switch to Event 2
      vi.mocked(api.listOrganizationEventAttendance).mockResolvedValueOnce([]);
      const select = screen.getByRole("combobox");
      await user.selectOptions(select, mockEvent2.id);

      await waitFor(() => {
        expect(screen.queryByRole("button", { name: /^Undo/i })).not.toBeInTheDocument();
      });
    });
  });
});

it("failed save must preserve a newer server-refetched value", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const row: OrganizationAttendanceRow = {
    profileId: "11111111-1111-4111-8111-111111111111",
    displayName: "Singer",
    voicePart: "S1",
    rsvp: "Yes",
    attendance: "Pending",
    updatedAt: null,
  };
  const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let rejectSave: ((error: Error) => void) | undefined;
  vi.mocked(api.updateOrganizationEventAttendance).mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  client.setQueryData(api.queryKeys.organization.attendance(eventId), [row]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAttendanceMutations({ eventId, rows: [row] }), {
    wrapper,
  });
  await act(async () => {
    await Promise.resolve();
    result.current.changeAttendance(row.profileId);
  });
  await act(async () => {
    await Promise.resolve();
    client.setQueryData(api.queryKeys.organization.attendance(eventId), [
      { ...row, attendance: "Absent", updatedAt: new Date().toISOString() },
    ]);
    rejectSave?.(new Error("request failed"));
    await Promise.resolve();
  });
  expect(
    client.getQueryData<readonly OrganizationAttendanceRow[]>(
      api.queryKeys.organization.attendance(eventId),
    )?.[0]?.attendance,
  ).toBe("Absent");
});

it("bulk failure restores only unchanged optimistic rows after a server refresh", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const rows: readonly OrganizationAttendanceRow[] = [
    {
      profileId: "11111111-1111-4111-8111-111111111111",
      displayName: "Singer A",
      voicePart: "S1",
      rsvp: "Yes",
      attendance: "Pending",
      updatedAt: null,
    },
    {
      profileId: "22222222-2222-4222-8222-222222222222",
      displayName: "Singer B",
      voicePart: "S1",
      rsvp: "Yes",
      attendance: "Pending",
      updatedAt: null,
    },
  ];
  let rejectSave: ((error: Error) => void) | undefined;
  vi.mocked(api.updateOrganizationEventAttendance).mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  client.setQueryData(api.queryKeys.organization.attendance(eventId), rows);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useAttendanceMutations({ eventId, rows }), { wrapper });
  let pending: Promise<void> | undefined;
  await act(async () => {
    await Promise.resolve();
    pending = result.current.markRemainingPresent(rows);
  });
  await act(async () => {
    await Promise.resolve();
    client.setQueryData(
      api.queryKeys.organization.attendance(eventId),
      (current: readonly OrganizationAttendanceRow[] | undefined) =>
        current?.map((row, index) =>
          index === 0
            ? { ...row, attendance: "Absent", updatedAt: "2026-09-30T12:00:00.000Z" }
            : row,
        ),
    );
    rejectSave?.(new Error("request failed"));
    await pending;
  });
  expect(
    client
      .getQueryData<readonly OrganizationAttendanceRow[]>(
        api.queryKeys.organization.attendance(eventId),
      )
      ?.map((row) => row.attendance),
  ).toEqual(["Absent", "Pending"]);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Attendance refresh coordination", () => {
  let client: QueryClient;
  const key = api.queryKeys.organization.attendance(mockEvent.id);

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    focusManager.setFocused(true);
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false },
      },
    });
    client.setQueryData(api.queryKeys.organization.calendarSettings, {
      timezone: "America/New_York",
    });
    client.setQueryData(api.queryKeys.organization.events, [mockEvent]);
    client.setQueryData(api.queryKeys.organization.venues, [mockVenue]);
    client.setQueryData(api.queryKeys.organization.rosterConfiguration, mockRosterConfig);
    client.setQueryData(key, mockRows);
    vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue(mockRows);
  });

  afterEach(() => {
    cleanup();
    client.clear();
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  function renderAttendance(query = "") {
    return renderHook(
      () => {
        const queries = useAttendanceQueries(true);
        const mutations = useAttendanceMutations({ eventId: queries.eventId, rows: queries.rows });
        const filtering = useAttendanceFiltering({
          filter: "All",
          query,
          rows: queries.rows,
          rosterConfiguration: queries.rosterConfiguration,
          savingIds: mutations.savingIds,
        });
        return { ...queries, ...mutations, ...filtering };
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
  }

  async function advance(milliseconds: number) {
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }

  it("keeps today's started event eligible in the Organization timezone and preserves manual choice", () => {
    vi.setSystemTime(new Date("2026-10-16T03:59:00Z")); // Still October 15 in New York.
    const tomorrow = { ...mockEvent, id: "tomorrow", startsAt: "2026-10-16T19:00:00Z" };
    client.setQueryData(api.queryKeys.organization.events, [tomorrow, mockEvent]);
    const { result } = renderAttendance();
    expect(result.current.eventId).toBe(mockEvent.id);
    act(() => {
      result.current.setSelectedEventId(tomorrow.id);
    });
    client.setQueryData(api.queryKeys.organization.events, [mockEvent, tomorrow]);
    expect(result.current.eventId).toBe(tomorrow.id);
  });

  it("moves to the upcoming event after Organization-local midnight", () => {
    vi.setSystemTime(new Date("2026-10-16T04:00:00Z"));
    const tomorrow = { ...mockEvent, id: "tomorrow", startsAt: "2026-10-16T19:00:00Z" };
    client.setQueryData(api.queryKeys.organization.events, [mockEvent, tomorrow]);
    const { result } = renderAttendance();
    expect(result.current.eventId).toBe(tomorrow.id);
  });

  it("uses the refreshed eligible set for search, counters, progress, and bulk targets", async () => {
    const eligible = mockRows[0];
    if (!eligible) throw new Error("Missing attendance fixture");
    const archived = { ...eligible, profileId: "archived" };
    const archivedUnique = {
      ...eligible,
      profileId: "archived-unique",
      displayName: "Archived Unique",
    };
    client.setQueryData(key, [eligible, archived, archivedUnique]);
    const { result } = renderAttendance("Alice");
    expect(result.current.counts.expected).toBe(3);
    expect(result.current.groupedRows.rsvped.flatMap((group) => group.rows)).toHaveLength(2);
    vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue([eligible]);
    await advance(5_000);
    await advance(1);
    expect(result.current.rows).toEqual([eligible]);
    expect(result.current.counts).toMatchObject({
      expected: 1,
      roster: 1,
      pending: 1,
      present: 0,
      presentTotal: 0,
      absent: 0,
    });
    expect(result.current.groupedRows.rsvped.flatMap((group) => group.rows)).toEqual([eligible]);
    expect(result.current.markableRows).toEqual([eligible]);
    const saved = [{ ...eligible, attendance: "Present" as const }];
    vi.mocked(api.updateOrganizationEventAttendance).mockResolvedValue(saved);
    vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue(saved);
    await act(async () => {
      await result.current.markRemainingPresent(result.current.markableRows);
    });
    await advance(1);
    expect(api.updateOrganizationEventAttendance).toHaveBeenCalledWith(mockEvent.id, [
      { profileId: eligible.profileId, attendance: "Present" },
    ]);
    expect(result.current.counts).toMatchObject({
      expected: 1,
      pending: 0,
      present: 1,
      presentTotal: 1,
    });
    await advance(5_000);
    expect(result.current.rows).toEqual(saved);
  });

  it.each([false, true])(
    "refreshes archived profiles away after a stale save (bulk: %s)",
    async (bulk) => {
      const eligible = mockRows[0];
      if (!eligible) throw new Error("Missing attendance fixture");
      const archived = { ...eligible, profileId: "archived" };
      client.setQueryData(key, [eligible, archived]);
      vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue([eligible]);
      const explanation = "A selected profile has been archived. Refresh attendance and try again.";
      vi.mocked(api.updateOrganizationEventAttendance).mockRejectedValue(
        new api.AuthApiError(explanation, 409, "attendance_profile_ineligible"),
      );
      const { result } = renderAttendance();
      await act(async () => {
        if (bulk) await result.current.markRemainingPresent(result.current.markableRows);
        else result.current.changeAttendance(archived.profileId);
      });
      await advance(1);
      expect(result.current.message).toBe(explanation);
      expect(result.current.rows).toEqual([eligible]);
      expect(result.current.counts).toMatchObject({ expected: 1, pending: 1, present: 0 });
      await advance(5_000);
      expect(result.current.rows).toEqual([eligible]);
    },
  );

  it("polls every five seconds only while visible", async () => {
    renderAttendance();
    await advance(4_999);
    expect(api.listOrganizationEventAttendance).not.toHaveBeenCalled();
    await advance(1);
    expect(api.listOrganizationEventAttendance).toHaveBeenCalledTimes(1);
    act(() => {
      focusManager.setFocused(false);
    });
    await advance(15_000);
    expect(api.listOrganizationEventAttendance).toHaveBeenCalledTimes(1);
    act(() => {
      focusManager.setFocused(true);
    });
    await advance(5_000);
    expect(api.listOrganizationEventAttendance).toHaveBeenCalledTimes(2);
  });

  it("cancels an in-flight poll before optimistic saving and ignores its late response", async () => {
    const poll = deferred<readonly OrganizationAttendanceRow[]>();
    const save = deferred<readonly OrganizationAttendanceRow[]>();
    vi.mocked(api.listOrganizationEventAttendance).mockReturnValueOnce(poll.promise);
    vi.mocked(api.updateOrganizationEventAttendance).mockReturnValueOnce(save.promise);
    const { result } = renderAttendance();
    await advance(5_000);
    const signal = vi.mocked(api.listOrganizationEventAttendance).mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);
    await act(async () => {
      await Promise.resolve();
      result.current.changeAttendance("p-1");
    });
    expect(signal?.aborted).toBe(true);
    expect(result.current.rows[0]?.attendance).toBe("Present");
    await act(async () => {
      await Promise.resolve();
      poll.resolve(mockRows);
    });
    await advance(15_000);
    expect(api.listOrganizationEventAttendance).toHaveBeenCalledTimes(1);
    expect(result.current.rows[0]?.attendance).toBe("Present");
    const saved = mockRows.map((row) =>
      row.profileId === "p-1" ? { ...row, attendance: "Present" as const } : row,
    );
    vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue(saved);
    await act(async () => {
      await Promise.resolve();
      save.resolve(saved);
    });
    await advance(1);
    expect(api.listOrganizationEventAttendance).toHaveBeenCalledTimes(2);
    expect(result.current.rows[0]?.attendance).toBe("Present");
    await advance(5_000);
    expect(api.listOrganizationEventAttendance).toHaveBeenCalledTimes(3);
  });

  it("waits for every concurrent row save before refreshing, including failures", async () => {
    const first = deferred<readonly OrganizationAttendanceRow[]>();
    const second = deferred<readonly OrganizationAttendanceRow[]>();
    vi.mocked(api.updateOrganizationEventAttendance)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderAttendance();
    await act(async () => {
      await Promise.resolve();
      result.current.changeAttendance("p-1");
      result.current.changeAttendance("p-2");
    });
    await advance(10_000);
    expect(api.listOrganizationEventAttendance).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
      first.resolve(mockRows.slice(0, 1).map((row) => ({ ...row, attendance: "Present" })));
    });
    await advance(5_000);
    expect(api.listOrganizationEventAttendance).not.toHaveBeenCalled();
    expect(result.current.rows[1]?.attendance).toBe("Present");
    vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue(
      mockRows.map((row) => (row.profileId === "p-1" ? { ...row, attendance: "Present" } : row)),
    );
    await act(async () => {
      await Promise.resolve();
      second.reject(new Error("Save failed"));
    });
    await advance(1);
    expect(api.listOrganizationEventAttendance).toHaveBeenCalledTimes(1);
    expect(result.current.rows.map((row) => row.attendance)).toEqual([
      "Present",
      "Pending",
      "Pending",
      "Pending",
    ]);
    expect(result.current.message).toContain("could not be saved");
  });

  it("refreshes once when concurrent saves finish together", async () => {
    const first = deferred<readonly OrganizationAttendanceRow[]>();
    const second = deferred<readonly OrganizationAttendanceRow[]>();
    vi.mocked(api.updateOrganizationEventAttendance)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderAttendance();
    await act(async () => {
      await Promise.resolve();
      result.current.changeAttendance("p-1");
      result.current.changeAttendance("p-2");
    });
    const saved = mockRows.map((row) =>
      ["p-1", "p-2"].includes(row.profileId) ? { ...row, attendance: "Present" as const } : row,
    );
    vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue(saved);
    await act(async () => {
      await Promise.resolve();
      first.resolve(saved);
      second.resolve(saved);
    });
    await advance(1);
    expect(api.listOrganizationEventAttendance).toHaveBeenCalledTimes(1);
  });

  it("keeps pending saves and their completion refresh tied to the original event", async () => {
    const save = deferred<readonly OrganizationAttendanceRow[]>();
    vi.mocked(api.updateOrganizationEventAttendance).mockReturnValueOnce(save.promise);
    const otherEventId = "33333333-3333-4333-8333-333333333333";
    client.setQueryData(api.queryKeys.organization.attendance(otherEventId), mockRows);
    const { result } = renderAttendance();
    await act(async () => {
      await Promise.resolve();
      result.current.changeAttendance("p-1");
    });
    act(() => {
      result.current.setSelectedEventId(otherEventId);
    });
    await advance(5_000);
    expect(api.listOrganizationEventAttendance).toHaveBeenCalledWith(
      otherEventId,
      expect.any(AbortSignal),
    );
    await act(async () => {
      await Promise.resolve();
      save.resolve(mockRows.slice(0, 1).map((row) => ({ ...row, attendance: "Present" })));
    });
    await advance(1);
    expect(result.current.eventId).toBe(otherEventId);
    expect(result.current.rows[0]?.attendance).toBe("Pending");
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryData<readonly OrganizationAttendanceRow[]>(key)?.[0]?.attendance).toBe(
      "Present",
    );
  });

  it.each([true, false])(
    "protects bulk saves and refreshes after settlement (success: %s)",
    async (success) => {
      const save = deferred<readonly OrganizationAttendanceRow[]>();
      vi.mocked(api.updateOrganizationEventAttendance).mockReturnValueOnce(save.promise);
      const { result } = renderAttendance();
      let saving: Promise<void> | undefined;
      await act(async () => {
        await Promise.resolve();
        saving = result.current.markRemainingPresent(mockRows);
      });
      await advance(15_000);
      expect(api.listOrganizationEventAttendance).not.toHaveBeenCalled();
      expect(result.current.rows.every((row) => row.attendance === "Present")).toBe(true);
      const saved = mockRows.map((row) => ({ ...row, attendance: "Present" as const }));
      vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue(success ? saved : mockRows);
      await act(async () => {
        await Promise.resolve();
        if (success) save.resolve(saved);
        else save.reject(new Error("Bulk failed"));
        await saving;
      });
      await advance(1);
      expect(api.listOrganizationEventAttendance).toHaveBeenCalledTimes(1);
      expect(
        result.current.rows.every((row) => row.attendance === (success ? "Present" : "Pending")),
      ).toBe(true);
    },
  );
});
