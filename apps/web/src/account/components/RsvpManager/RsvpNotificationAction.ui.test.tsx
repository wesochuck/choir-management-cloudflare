import type { OrganizationAttendanceRow } from "@choir/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewOrganizationCommunicationReach } from "../../../api";
import { RsvpNotificationAction } from "./RsvpNotificationAction";

vi.mock("../../../api", () => ({ previewOrganizationCommunicationReach: vi.fn() }));
const rows: readonly OrganizationAttendanceRow[] = [
  {
    attendance: "Pending",
    displayName: "Singer",
    profileId: "profile-1",
    rsvp: "Pending",
    updatedAt: null,
    voicePart: "S1",
  },
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe("RSVP notification action", () => {
  it("previews actual email reach for active nonresponders and opens review without sending", async () => {
    vi.mocked(previewOrganizationCommunicationReach).mockResolvedValue({
      both: 0,
      email: 1,
      sms: 0,
      total: 2,
      unreachable: 1,
      ticketBuyerPurchasesOverLimit: 0,
      undeliverableTicketBuyerPurchases: 0,
    });
    const onNavigate = vi.fn();
    render(<RsvpNotificationAction eventId="event-1" rows={rows} onNavigate={onNavigate} />);
    expect(
      await screen.findByText(/1 awaiting response can receive RSVP email/),
    ).toBeInTheDocument();
    expect(previewOrganizationCommunicationReach).toHaveBeenCalledWith(
      {
        audience: expect.objectContaining({
          eventId: "event-1",
          globalStatuses: ["Active"],
          rsvp: "Pending",
          voiceParts: ["S1"],
        }),
        channel: "Email",
      },
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("link", { name: "Request RSVPs" }));
    expect(onNavigate).toHaveBeenCalledWith(
      "/admin/communications?tab=compose&rsvpEventId=event-1&rsvpPart=S1",
    );
  });

  it("can notify On Break and Inactive nonresponders without Active members", async () => {
    vi.mocked(previewOrganizationCommunicationReach).mockResolvedValue({
      both: 0,
      email: 2,
      sms: 0,
      total: 2,
      unreachable: 0,
      ticketBuyerPurchasesOverLimit: 0,
      undeliverableTicketBuyerPurchases: 0,
    });
    render(<RsvpNotificationAction eventId="event-1" rows={rows} />);
    expect(screen.getByRole("checkbox", { name: "Active" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "On Break" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Active" }));
    expect(screen.getByText(/Select at least one member status/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Request RSVPs" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "On Break" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Inactive" }));
    await waitFor(() => {
      expect(previewOrganizationCommunicationReach).toHaveBeenLastCalledWith(
        {
          audience: expect.objectContaining({
            globalStatuses: ["Idle", "Inactive"],
            rsvp: "Pending",
          }),
          channel: "Email",
        },
        expect.any(AbortSignal),
      );
    });
    expect(screen.getByRole("link", { name: "Request RSVPs" })).toHaveAttribute(
      "href",
      "/admin/communications?tab=compose&rsvpEventId=event-1&rsvpPart=S1&rsvpStatus=Idle&rsvpStatus=Inactive",
    );
  });

  it("shows a recipient-preview failure without treating it as zero recipients", async () => {
    vi.mocked(previewOrganizationCommunicationReach).mockRejectedValue(new Error("Unavailable"));
    render(<RsvpNotificationAction eventId="event-1" rows={rows} />);
    expect(await screen.findByText(/Email recipient count unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request RSVPs" })).toBeInTheDocument();
  });

  it("does not open an unrestricted message when there are no performer parts", () => {
    render(<RsvpNotificationAction eventId="event-1" rows={[]} />);
    expect(screen.getByText(/No performers to notify/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Request RSVPs" })).not.toBeInTheDocument();
    expect(previewOrganizationCommunicationReach).not.toHaveBeenCalled();
  });

  it("aborts an obsolete event preview", async () => {
    vi.mocked(previewOrganizationCommunicationReach).mockResolvedValue({
      both: 0,
      email: 0,
      sms: 0,
      total: 0,
      unreachable: 0,
      ticketBuyerPurchasesOverLimit: 0,
      undeliverableTicketBuyerPurchases: 0,
    });
    const { rerender } = render(<RsvpNotificationAction eventId="event-1" rows={rows} />);
    const signal = vi.mocked(previewOrganizationCommunicationReach).mock.calls[0]?.[1];
    rerender(<RsvpNotificationAction eventId="event-2" rows={rows} />);
    expect(signal?.aborted).toBe(true);
    await waitFor(() => {
      expect(previewOrganizationCommunicationReach).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByText(/0 awaiting response can receive RSVP email/),
    ).toBeInTheDocument();
  });
});
