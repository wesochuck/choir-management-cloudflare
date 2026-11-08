import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";
import { TicketingManager } from "./TicketingManager";
import { AuditionManager } from "./components/AuditionManager/page";
import { fallbackSettings } from "./components/AuditionManager/utils";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getOrganizationCalendarSettings: vi.fn(),
  getOrganizationAuditionSettings: vi.fn(),
  getOrganizationRosterConfiguration: vi.fn(),
  listOrganizationAuditions: vi.fn(),
  listOrganizationMemberships: vi.fn(),
  listOrganizationProfiles: vi.fn(),
  listOrganizationEvents: vi.fn(),
  listOrganizationVenues: vi.fn(),
}));

let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(api.listOrganizationAuditions).mockResolvedValue([]);
  vi.mocked(api.getOrganizationAuditionSettings).mockResolvedValue(fallbackSettings);
  vi.mocked(api.getOrganizationRosterConfiguration).mockResolvedValue({
    attendanceReportWarningThreshold: 1,
    onBreakTimeoutDays: 30,
    onBreakTimeoutEnabled: false,
    performerLabel: "Singer",
    rehearsalAttendanceReportsEnabled: true,
    rsvpExpiryEnabled: false,
    rsvpFollowUpEnabled: false,
    rsvpFollowUpLeadHours: 24,
    sections: [],
    statusAutomationEnabled: false,
    statusAutomationMissThreshold: 3,
    statusAutomationRecoveryEnabled: false,
    voiceParts: [],
  });
  vi.mocked(api.listOrganizationMemberships).mockResolvedValue({
    memberships: [],
    requestId: "req-test",
    truncated: false,
  });
  vi.mocked(api.listOrganizationProfiles).mockResolvedValue([]);
  vi.mocked(api.listOrganizationEvents).mockResolvedValue([]);
  vi.mocked(api.listOrganizationVenues).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  client.clear();
});

describe("manager timezone loading", () => {
  it.each(["scanner", "auditions"] as const)(
    "blocks %s until settings are available and supports Retry",
    async (manager) => {
      let rejectSettings: ((reason: Error) => void) | undefined;
      vi.mocked(api.getOrganizationCalendarSettings)
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectSettings = reject;
            }),
        )
        .mockResolvedValue({ timezone: "America/New_York" });
      render(
        <QueryClientProvider client={client}>
          {manager === "scanner" ? (
            <TicketingManager enabled scanOnly />
          ) : (
            <AuditionManager enabled />
          )}
        </QueryClientProvider>,
      );
      expect(await screen.findByText("Loading Organization timezone…")).toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "New audition" })).not.toBeInTheDocument();
      await act(async () => {
        rejectSettings?.(new Error("unavailable"));
        await Promise.resolve();
      });
      expect(await screen.findByRole("alert")).toHaveTextContent("timezone could not be loaded");
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      if (manager === "scanner") {
        expect(await screen.findByRole("region", { name: "Ticket scanner" })).toBeInTheDocument();
      } else {
        expect(await screen.findByRole("button", { name: "New audition" })).toBeInTheDocument();
      }
      expect(api.getOrganizationCalendarSettings).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects an invalid timezone instead of rendering the scanner", async () => {
    vi.mocked(api.getOrganizationCalendarSettings).mockResolvedValue({ timezone: "Not/A_Zone" });
    render(
      <QueryClientProvider client={client}>
        <TicketingManager enabled scanOnly />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("timezone could not be loaded");
    expect(screen.queryByRole("region", { name: "Ticket scanner" })).not.toBeInTheDocument();
  });
});
