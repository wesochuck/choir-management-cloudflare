import {
  type OrganizationAttendanceRow,
  type OrganizationEvent,
  organizationEventSchema,
  type OrganizationRosterConfiguration,
  type OrganizationVenue,
} from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../api";
import { AttendanceManager } from "./AttendanceManager";

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    getOrganizationRosterConfiguration: vi.fn(),
    listOrganizationEventAttendance: vi.fn(),
    listOrganizationEvents: vi.fn(),
    listOrganizationVenues: vi.fn(),
    updateOrganizationEventAttendance: vi.fn(),
  };
});

const mockRosterConfig: OrganizationRosterConfiguration = {
  attendanceReportWarningThreshold: 1,
  onBreakTimeoutDays: 365,
  onBreakTimeoutEnabled: true,
  performerLabel: "Singer",
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

    vi.mocked(api.listOrganizationEvents).mockResolvedValue([mockEvent]);
    vi.mocked(api.listOrganizationVenues).mockResolvedValue([mockVenue]);
    vi.mocked(api.getOrganizationRosterConfiguration).mockResolvedValue(mockRosterConfig);
    vi.mocked(api.listOrganizationEventAttendance).mockResolvedValue(mockRows);
  });

  function renderComponent() {
    return render(
      <QueryClientProvider client={queryClient}>
        <AttendanceManager enabled={true} />
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
});
